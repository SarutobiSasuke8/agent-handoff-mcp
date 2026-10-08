import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { assertNoServers, recoveryPath, withRecoveryGuard } from "./recovery-lock.js";
import { parseRegistry } from "./registry.js";

const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
const metadataTable = "handoff_recovery_metadata";

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function syncFile(file: string): void {
  const descriptor = openSync(file, "r+");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function validateDatabase(db: DatabaseSync): void {
  const objects = db.prepare("SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
  if (objects.some((object) => object.type === "trigger" || object.type === "view" ||
    (object.type === "table" && !["handoffs", "handoff_events", metadataTable].includes(String(object.name))))) {
    throw new Error("Unexpected objects in the backup database.");
  }
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || Object.values(integrity[0]!)[0] !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) {
    throw new Error("Backup database integrity check failed.");
  }
  // Preparing these queries verifies the complete runtime column set without
  // running migrations or creating empty tables over a wrong database.
  db.prepare(`SELECT id, thread_id, parent_id, depth, sender, recipient, title, summary, request,
    context_refs_json, artifact_refs_json, tags_json, sensitivity, priority, status,
    created_at, updated_at, idempotency_key, payload_hash FROM handoffs LIMIT 0`).all();
  db.prepare("SELECT id, handoff_id, actor, event_type, from_status, to_status, note, created_at FROM handoff_events LIMIT 0").all();
  for (const table of ["handoffs", "handoff_events"]) {
    const id = db.prepare(`PRAGMA table_info('${table}')`).all().find((column) => column.name === "id");
    if (id?.pk !== 1 || id.type !== "TEXT") throw new Error("Invalid handoff primary key.");
  }
  const uniqueKey = db.prepare("PRAGMA index_list('handoffs')").all().some((index) => {
    if (index.unique !== 1) return false;
    const columns = db.prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno").all(index.name!);
    return JSON.stringify(columns.map((column) => column.name)) === '["sender","idempotency_key"]';
  });
  if (!uniqueKey) throw new Error("Missing idempotency constraint.");
}

function inspectBackup(file: string): string {
  if (!statSync(file).isFile()) throw new Error("Backup input must be a regular file.");
  if (statSync(file).size > MAX_BACKUP_BYTES) throw new Error("Backup exceeds the 128 MiB recovery limit.");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    validateDatabase(db);
    const rows = db.prepare(`SELECT version, registry, registry_sha256 FROM ${metadataTable}`).all();
    if (rows.length !== 1) throw new Error("Missing recovery metadata.");
    const row = rows[0]!;
    if (row.version !== 1 || typeof row.registry !== "string" || digest(row.registry) !== row.registry_sha256) {
      throw new Error("Invalid recovery metadata.");
    }
    parseRegistry(row.registry);
    return row.registry;
  } catch {
    // Never echo registry values or SQLite errors from an untrusted backup.
    throw new Error("Invalid or corrupt handoff backup; no destination files were replaced.");
  } finally { db.close(); }
}

export function backup(database: string, registry: string, output: string): void {
  withRecoveryGuard([database, registry], () => backupSnapshot(database, registry, output));
}

function backupSnapshot(database: string, registry: string, output: string): void {
  const source = recoveryPath(database);
  const policy = recoveryPath(registry);
  const target = recoveryPath(output);
  if ([source, policy].includes(target) || existsSync(target)) throw new Error("Backup output must be a new file, distinct from the database and registry.");
  if ([source, policy].some((file) => existsSync(`${file}.handoff-restore-pending`))) throw new Error("Cannot back up an interrupted restore.");
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = path.join(path.dirname(target), `.handoff-backup-${randomUUID()}.sqlite`);
  try {
    const registryText = readFileSync(policy, "utf8");
    try { parseRegistry(registryText); } catch { throw new Error("Backup requires a valid registry; registry values are not logged."); }
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout=5000;");
      validateDatabase(db);
      // Parameter binding avoids interpreting a filename as SQL.
      db.prepare("VACUUM INTO ?").run(temp);
    } finally { db.close(); }
    if (readFileSync(policy, "utf8") !== registryText) throw new Error("Registry changed during backup; retry after provisioning finishes.");
    chmodSync(temp, 0o600);
    const snapshot = new DatabaseSync(temp);
    try {
      snapshot.exec(`PRAGMA journal_mode=DELETE; DROP TABLE IF EXISTS ${metadataTable};
        CREATE TABLE ${metadataTable} (version INTEGER NOT NULL, registry TEXT NOT NULL, registry_sha256 TEXT NOT NULL);`);
      snapshot.prepare(`INSERT INTO ${metadataTable} VALUES (?, ?, ?)`).run(1, registryText, digest(registryText));
    } finally { snapshot.close(); }
    inspectBackup(temp);
    copyFileSync(temp, target, constants.COPYFILE_EXCL);
    chmodSync(target, 0o600);
    syncFile(target);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

export function restore(input: string, database: string, registry: string, force: boolean): void {
  const source = recoveryPath(input);
  const target = recoveryPath(database);
  const policy = recoveryPath(registry);
  if (new Set([source, target, policy]).size !== 3) throw new Error("Backup, database and registry paths must be distinct.");
  const registryText = inspectBackup(source);
  withRecoveryGuard([target, policy], () => {
    assertNoServers(target);
    assertNoServers(policy);
    if ([target, policy].some((file) => existsSync(`${file}.handoff-restore-pending`))) throw new Error("An interrupted restore needs operator recovery before retrying.");
    // An older server has no lease. Never replace a database with WAL sidecars,
    // even with --force: stop/checkpoint that instance first.
    if ([`${target}-wal`, `${target}-shm`].some(existsSync)) throw new Error("Database WAL sidecars remain; stop and checkpoint all servers before restore.");
    if (!force && [target, policy].some(existsSync)) throw new Error("Destination already exists; stopped-server replacement requires --force.");
    if ([target, policy].some((file) => existsSync(file) && !statSync(file).isFile())) throw new Error("Restore destinations must be regular files.");
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    mkdirSync(path.dirname(policy), { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const stagedDb = `${target}.${id}.restore`;
    const stagedPolicy = `${policy}.${id}.restore`;
    try {
      copyFileSync(source, stagedDb, constants.COPYFILE_EXCL);
      chmodSync(stagedDb, 0o600);
      syncFile(stagedDb);
      // Validate the copied bytes too: input could change after first inspection.
      if (inspectBackup(stagedDb) !== registryText) throw new Error("Backup changed during restore.");
      writeFileSync(stagedPolicy, registryText, { flag: "wx", mode: 0o600, flush: true });
      const pending = [target, policy].map((file) => `${file}.handoff-restore-pending`);
      for (const file of pending) writeFileSync(file, `Restore ${id} must install both the database and registry before startup.\n`, { flag: "wx", mode: 0o600, flush: true });
      // Preserve replaced files. If any step fails, the marker blocks startup
      // rather than serving a mixture of restored state and old policy.
      if (existsSync(target)) renameSync(target, `${target}.${id}.pre-restore`);
      if (existsSync(policy)) renameSync(policy, `${policy}.${id}.pre-restore`);
      renameSync(stagedDb, target);
      renameSync(stagedPolicy, policy);
      for (const file of pending) unlinkSync(file);
    } finally {
      for (const file of [stagedDb, stagedPolicy]) if (existsSync(file)) unlinkSync(file);
    }
  });
}
