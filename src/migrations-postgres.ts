import { CURRENT_SCHEMA_VERSION } from "./migrations.js";

import type { PoolClient } from "pg";

/**
 * Postgres migrations, numbered exactly like the SQLite migrations in
 * migrations.ts. Version N means the same logical schema in both adapters, so
 * CURRENT_SCHEMA_VERSION is shared and test/store-postgres.test.ts fails when a
 * SQLite migration is added without its Postgres counterpart.
 *
 * Dialect differences are deliberate and limited:
 * - timestamps stay ISO-8601 TEXT (same values and sort order as SQLite);
 * - handoff_events gains `seq`, an identity column that plays the role of
 *   SQLite's implicit rowid for stable event ordering.
 */
export const POSTGRES_MIGRATIONS: readonly { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE handoffs (
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
      CREATE INDEX idx_handoffs_recipient_status ON handoffs(recipient, status, created_at DESC);
      CREATE INDEX idx_handoffs_thread ON handoffs(thread_id, created_at);
      CREATE TABLE handoff_events (
        seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
        id TEXT PRIMARY KEY,
        handoff_id TEXT NOT NULL REFERENCES handoffs(id),
        actor TEXT NOT NULL,
        event_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_events_handoff ON handoff_events(handoff_id, created_at, seq);
    `,
  },
  {
    version: 2,
    sql: "ALTER TABLE handoffs ADD COLUMN payload_hash TEXT",
  },
];

/** Arbitrary fixed key so concurrent hosts serialise migration on one database. */
const MIGRATION_LOCK_KEY = "7243516001";

/**
 * Apply ordered migrations in one transaction under a transaction-scoped
 * advisory lock, so several hosts starting at once migrate exactly once.
 * Postgres DDL is transactional: a failed migration leaves no partial schema.
 */
export async function migratePostgresStore(client: PoolClient): Promise<void> {
  if (POSTGRES_MIGRATIONS.some((migration, index) => migration.version !== index + 1) || POSTGRES_MIGRATIONS.length !== CURRENT_SCHEMA_VERSION) {
    throw new Error("Postgres migrations are out of step with the SQLite schema version.");
  }
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [MIGRATION_LOCK_KEY]);
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const recorded = await client.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version");
    const versions = recorded.rows.map((row) => row.version);
    if (versions.some((version, index) => version !== index + 1) || versions.some((version) => version > CURRENT_SCHEMA_VERSION)) {
      throw new Error(`Store schema version is newer than this binary or has an invalid migration history (supported through ${CURRENT_SCHEMA_VERSION}).`);
    }
    if (versions.length === 0) {
      const existing = await client.query<{ handoffs: string | null; events: string | null }>(
        "SELECT to_regclass('handoffs')::text AS handoffs, to_regclass('handoff_events')::text AS events",
      );
      const row = existing.rows[0];
      if (row?.handoffs || row?.events) throw new Error("Unversioned Postgres handoff tables found; migration refused.");
    }
    const current = versions.length;
    for (const migration of POSTGRES_MIGRATIONS) {
      if (migration.version <= current) continue;
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)",
        [migration.version, new Date().toISOString()],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
