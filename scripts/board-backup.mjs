#!/usr/bin/env node
/**
 * Interim backup for the Agent Handoff Board hosted demo.
 *
 * Takes a consistent snapshot of the live SQLite database with `VACUUM INTO` (safe while
 * the server keeps running in WAL mode), checks it with `PRAGMA integrity_check`, copies
 * the registry beside it, and keeps the newest --keep snapshot pairs. Files are mode 0600.
 *
 * This is a stop-gap until the guarded `agent-handoff-mcp backup` command from issue #19
 * lands on main (open PR #20). That command also embeds and validates the registry and
 * pairs with a guarded `restore`; switch the compose backup service to it once merged.
 *
 * Usage:
 *   node scripts/board-backup.mjs --out-dir <dir> [--db <path>] [--registry <path>] [--keep <n>]
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "out-dir": { type: "string" },
    db: { type: "string" },
    registry: { type: "string" },
    keep: { type: "string" },
  },
  strict: true,
});

const outDir = values["out-dir"];
if (!outDir) {
  process.stderr.write("Usage: node scripts/board-backup.mjs --out-dir <dir> [--db <path>] [--registry <path>] [--keep <n>]\n");
  process.exit(2);
}
const database = path.resolve(values.db ?? process.env.HANDOFF_MCP_DB ?? "./data/handoffs.sqlite");
const registry = path.resolve(values.registry ?? process.env.HANDOFF_MCP_REGISTRY ?? "./config/agents.yaml");
const keep = Number.parseInt(values.keep ?? process.env.HANDOFF_BACKUP_KEEP ?? "14", 10);
if (!Number.isInteger(keep) || keep < 1) throw new Error("--keep must be a positive integer.");
if (!existsSync(database)) throw new Error(`Database not found: ${database}`);
if (!existsSync(registry)) throw new Error(`Registry not found: ${registry}`);

mkdirSync(outDir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
const dbOut = path.join(outDir, `handoffs-${stamp}.sqlite`);
const registryOut = path.join(outDir, `agents-${stamp}.yaml`);

const source = new DatabaseSync(database, { readOnly: true });
try {
  source.exec("PRAGMA busy_timeout=5000;");
  source.prepare("VACUUM INTO ?").run(dbOut);
} finally {
  source.close();
}

const check = new DatabaseSync(dbOut, { readOnly: true });
let integrity;
let counts;
try {
  integrity = check.prepare("PRAGMA integrity_check").get()?.integrity_check;
  counts = check.prepare("SELECT (SELECT COUNT(*) FROM handoffs) AS handoffs, (SELECT COUNT(*) FROM handoff_events) AS events").get();
} finally {
  check.close();
}
if (integrity !== "ok") {
  rmSync(dbOut, { force: true });
  throw new Error(`Snapshot failed integrity_check (${integrity}); nothing kept.`);
}
copyFileSync(registry, registryOut);
for (const file of [dbOut, registryOut]) chmodSync(file, 0o600);

const snapshots = readdirSync(outDir).filter((name) => /^handoffs-.+\.sqlite$/u.test(name)).sort().reverse();
for (const old of snapshots.slice(keep)) {
  const suffix = old.slice("handoffs-".length, -".sqlite".length);
  rmSync(path.join(outDir, old), { force: true });
  rmSync(path.join(outDir, `agents-${suffix}.yaml`), { force: true });
}

process.stdout.write(
  `Backup written: ${dbOut} (${counts.handoffs} handoffs, ${counts.events} events, integrity ok)\n` +
  `Registry copy:  ${registryOut}\nKeeping the newest ${keep} snapshot(s).\n`,
);
