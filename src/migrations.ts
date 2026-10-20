import type { DatabaseSync } from "node:sqlite";

export const CURRENT_SCHEMA_VERSION = 2;

const baseSchema = `
  CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    parent_id TEXT REFERENCES handoffs(id),
    depth INTEGER NOT NULL CHECK(depth >= 0),
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    request TEXT NOT NULL,
    context_refs_json TEXT NOT NULL,
    artifact_refs_json TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    sensitivity TEXT NOT NULL CHECK(sensitivity IN ('public-safe','internal','restricted')),
    priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
    status TEXT NOT NULL CHECK(status IN ('queued','accepted','blocked','completed','cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    idempotency_key TEXT,
    UNIQUE(sender, idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS idx_handoffs_recipient_status ON handoffs(recipient, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_handoffs_thread ON handoffs(thread_id, created_at);
  CREATE TABLE IF NOT EXISTS handoff_events (
    id TEXT PRIMARY KEY,
    handoff_id TEXT NOT NULL REFERENCES handoffs(id),
    actor TEXT NOT NULL,
    event_type TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_handoff ON handoff_events(handoff_id, created_at);
`;

function hasPayloadHash(db: DatabaseSync): boolean {
  const columns = db.prepare("SELECT name FROM pragma_table_info('handoffs')").all() as unknown as { name: string }[];
  return columns.some((column) => column.name === "payload_hash");
}

/** Apply ordered migrations atomically. Existing unversioned stores are recorded at their observed version. */
export function migrateStore(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const recorded = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as unknown as { version: number }[];
    const versions = recorded.map((row) => row.version);
    if (versions.some((version, index) => version !== index + 1) || versions.some((version) => version > CURRENT_SCHEMA_VERSION)) {
      throw new Error(`Store schema version is newer than this binary or has an invalid migration history (supported through ${CURRENT_SCHEMA_VERSION}).`);
    }
    if (versions.length === 0) {
      const legacy = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('handoffs', 'handoff_events')").all() as unknown as { name: string }[];
      if (legacy.length === 1) throw new Error("Incomplete legacy handoff store; migration refused.");
      if (legacy.length === 2) {
        db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(1, new Date().toISOString());
        if (hasPayloadHash(db)) {
          db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(2, new Date().toISOString());
        }
      }
    }
    const current = (db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null }).version ?? 0;
    for (let version = current + 1; version <= CURRENT_SCHEMA_VERSION; version += 1) {
      if (version === 1) db.exec(baseSchema);
      if (version === 2 && !hasPayloadHash(db)) db.exec("ALTER TABLE handoffs ADD COLUMN payload_hash TEXT");
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
