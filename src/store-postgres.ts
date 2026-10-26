import { randomUUID } from "node:crypto";

import { DomainError } from "./errors.js";
import { operationalMetrics } from "./metrics.js";
import { migratePostgresStore } from "./migrations-postgres.js";
import { allowedTransition } from "./store-adapter.js";
import { payloadHash, rowPayloadHash, toEvent, toHandoff } from "./store.js";

import type pgModule from "pg";
import type { Pool, PoolClient } from "pg";
import type { NotificationSink } from "./notifications.js";
import type { HandoffStoreAdapter } from "./store-adapter.js";
import type { EventRow, HandoffRow } from "./store.js";
import type { CreateHandoffInput, Handoff, HandoffEvent, HandoffStatus } from "./types.js";

export interface PostgresStoreOptions {
  /** libpq-style connection string. Treated as a secret: never logged or echoed. */
  connectionString: string;
  /** Optional schema to create and use (search_path). Used by tests for isolation. */
  schema?: string;
  /** Pool size per host. Default 5. */
  maxConnections?: number;
}

/** Database clock in the same ISO-8601 shape as Date#toISOString, so all hosts share one clock. */
const NOW_SQL = `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now`;
const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;

async function loadPool(options: PostgresStoreOptions): Promise<Pool> {
  let pg: typeof pgModule;
  try {
    pg = (await import("pg")).default;
  } catch {
    throw new Error("HANDOFF_STORE=postgres needs the optional 'pg' dependency; install it with npm install pg.");
  }
  if (options.schema !== undefined && !SCHEMA_PATTERN.test(options.schema)) {
    throw new Error("Postgres schema name must match [a-z_][a-z0-9_]*.");
  }
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 5,
    application_name: "agent-handoff-mcp",
    // Mirrors SQLite's busy_timeout: a contended row lock fails fast instead of hanging.
    lock_timeout: 5_000,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  // An idle client losing its connection must not crash the process.
  pool.on("error", () => operationalMetrics.storeError());
  const schema = options.schema;
  if (schema) {
    // Set per connection rather than as a startup option, which some servers and poolers ignore.
    pool.on("connect", (client) => {
      client.query(`SET search_path TO ${schema}`).catch(() => operationalMetrics.storeError());
    });
  }
  return pool;
}

/**
 * EXPERIMENTAL Postgres adapter for multi-host deployments.
 *
 * Same contract as the SQLite `HandoffStore`; see docs/STORE-POSTGRES.md.
 * Lifecycle changes lock the handoff row (SELECT ... FOR UPDATE) and update it
 * conditionally on the status that was checked, so two hosts acknowledging the
 * same handoff serialise and exactly one wins.
 */
export class PostgresHandoffStore implements HandoffStoreAdapter {
  private readonly opening: Promise<Pool>;
  private closed = false;

  public constructor(private readonly options: PostgresStoreOptions) {
    this.opening = this.open();
    // Startup failures are reported by ready(); avoid an unhandled rejection meanwhile.
    this.opening.catch(() => undefined);
  }

  public async ready(): Promise<void> {
    await this.opening;
  }

  public async create(
    sender: string,
    input: CreateHandoffInput,
    maxDepth: number,
    notificationSink?: NotificationSink,
  ): Promise<Handoff> {
    const hash = payloadHash(input);
    return this.inTransaction(async (client) => {
      if (input.idempotencyKey) {
        const existing = await this.findIdempotent(client, sender, input.idempotencyKey, hash);
        if (existing) return { value: existing, created: false };
      }

      const parent = input.parentId ? await this.getWith(client, input.parentId) : undefined;
      const depth = parent ? parent.depth + 1 : 0;
      if (depth > maxDepth) throw new DomainError(`Maximum handoff depth of ${maxDepth} exceeded.`);

      const id = randomUUID();
      const threadId = parent?.threadId ?? id;
      const now = await this.now(client);
      const inserted = await client.query<HandoffRow>(`
        INSERT INTO handoffs (
          id, thread_id, parent_id, depth, sender, recipient, title, summary, request,
          context_refs_json, artifact_refs_json, tags_json, sensitivity, priority, status,
          created_at, updated_at, idempotency_key, payload_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'queued', $15, $16, $17, $18)
        ON CONFLICT (sender, idempotency_key) DO NOTHING
        RETURNING *
      `, [
        id,
        threadId,
        input.parentId ?? null,
        depth,
        sender,
        input.recipient,
        input.title,
        input.summary,
        input.request,
        JSON.stringify(input.contextRefs),
        JSON.stringify(input.artifactRefs),
        JSON.stringify(input.tags),
        input.sensitivity,
        input.priority,
        now,
        now,
        input.idempotencyKey ?? null,
        hash,
      ]);
      const row = inserted.rows[0];
      if (!row) {
        // A concurrent request with the same (sender, idempotency_key) committed
        // first. READ COMMITTED gives this statement a fresh snapshot, so the
        // winning row is visible and is verified exactly like a retry.
        const winner = input.idempotencyKey
          ? await this.findIdempotent(client, sender, input.idempotencyKey, hash)
          : undefined;
        if (!winner) throw new Error("Handoff insert conflicted without a visible winner.");
        return { value: winner, created: false };
      }
      await this.insertEvent(client, id, sender, "created", undefined, "queued", undefined, now);
      return { value: toHandoff(row), created: true };
    }, (result) => {
      if (!result.created) return;
      operationalMetrics.handoffCreated();
      try {
        notificationSink?.record(result.value);
      } catch {
        // The handoff is committed. Notification failure must not turn it into a failed send.
        process.stderr.write("Handoff notification write failed.\n");
      }
    });
  }

  public async get(id: string): Promise<Handoff> {
    const handoff = await this.find(id);
    if (!handoff) throw new DomainError(`Handoff '${id}' was not found.`);
    return handoff;
  }

  public async find(id: string): Promise<Handoff | undefined> {
    const pool = await this.opening;
    const result = await pool.query<HandoffRow>("SELECT * FROM handoffs WHERE id = $1", [id]);
    const row = result.rows[0];
    return row ? toHandoff(row) : undefined;
  }

  public async inbox(recipient: string, statuses: HandoffStatus[], limit: number): Promise<Handoff[]> {
    const pool = await this.opening;
    const result = await pool.query<HandoffRow>(
      "SELECT * FROM handoffs WHERE recipient = $1 AND status = ANY($2::text[]) ORDER BY created_at DESC LIMIT $3",
      [recipient, statuses, limit],
    );
    return result.rows.map(toHandoff);
  }

  public async events(handoffId: string): Promise<HandoffEvent[]> {
    const pool = await this.opening;
    const result = await pool.query<EventRow>(
      "SELECT id, handoff_id, actor, event_type, from_status, to_status, note, created_at FROM handoff_events WHERE handoff_id = $1 ORDER BY created_at, seq",
      [handoffId],
    );
    return result.rows.map(toEvent);
  }

  public async transition(
    handoffId: string,
    actor: string,
    toStatus: Exclude<HandoffStatus, "queued">,
    note?: string,
  ): Promise<Handoff> {
    return this.inTransaction(async (client) => {
      // Row lock: a second host acknowledging the same handoff waits here,
      // then re-reads the committed status and fails the lifecycle check.
      const locked = await client.query<HandoffRow>("SELECT * FROM handoffs WHERE id = $1 FOR UPDATE", [handoffId]);
      const lockedRow = locked.rows[0];
      if (!lockedRow) throw new DomainError(`Handoff '${handoffId}' was not found.`);
      const current = toHandoff(lockedRow);
      if (!allowedTransition(current, actor, toStatus)) {
        throw new DomainError(`Agent '${actor}' may not move '${current.status}' to '${toStatus}'.`);
      }
      const now = await this.now(client);
      // Conditional update: belt and braces on top of the row lock. Zero rows
      // means the status moved underneath us, which the lock should make impossible.
      const updated = await client.query<HandoffRow>(
        "UPDATE handoffs SET status = $1, updated_at = $2 WHERE id = $3 AND status = $4 RETURNING *",
        [toStatus, now, handoffId, current.status],
      );
      const updatedRow = updated.rows[0];
      if (updated.rowCount !== 1 || !updatedRow) {
        throw new DomainError(`Handoff '${handoffId}' changed concurrently; re-read it and retry.`);
      }
      await this.insertEvent(client, handoffId, actor, toStatus, current.status, toStatus, note, now);
      return { value: toHandoff(updatedRow), claimed: current.status === "queued" && toStatus === "accepted" };
    }, (result) => { if (result.claimed) operationalMetrics.handoffClaimed(); });
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const pool = await this.opening.catch(() => undefined);
    await pool?.end();
  }

  private async open(): Promise<Pool> {
    const pool = await loadPool(this.options);
    try {
      const client = await pool.connect();
      try {
        if (this.options.schema) await client.query(`CREATE SCHEMA IF NOT EXISTS ${this.options.schema}`);
        await migratePostgresStore(client);
      } finally {
        client.release();
      }
      return pool;
    } catch (error) {
      if (!(error instanceof DomainError)) operationalMetrics.storeError();
      await pool.end().catch(() => undefined);
      throw error;
    }
  }

  private async inTransaction<R extends { value: T }, T>(
    work: (client: PoolClient) => Promise<R>,
    afterCommit: (result: R) => void,
  ): Promise<T> {
    const pool = await this.opening;
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const result = await work(client);
      await client.query("COMMIT");
      afterCommit(result);
      return result.value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (!(error instanceof DomainError)) operationalMetrics.storeError();
      throw error;
    } finally {
      client.release();
    }
  }

  private async findIdempotent(client: PoolClient, sender: string, key: string, hash: string): Promise<Handoff | undefined> {
    const result = await client.query<HandoffRow>(
      "SELECT * FROM handoffs WHERE sender = $1 AND idempotency_key = $2",
      [sender, key],
    );
    const existing = result.rows[0];
    if (!existing) return undefined;
    if (rowPayloadHash(existing) !== hash) {
      throw new DomainError(
        `Idempotency key '${key}' was already used by '${sender}' with a different payload. ` +
        "Reuse a key only to retry the identical handoff; use a new key for new content.",
      );
    }
    return toHandoff(existing);
  }

  private async getWith(client: PoolClient, id: string): Promise<Handoff> {
    const result = await client.query<HandoffRow>("SELECT * FROM handoffs WHERE id = $1", [id]);
    const row = result.rows[0];
    if (!row) throw new DomainError(`Handoff '${id}' was not found.`);
    return toHandoff(row);
  }

  private async now(client: PoolClient): Promise<string> {
    const result = await client.query<{ now: string }>(NOW_SQL);
    const now = result.rows[0]?.now;
    if (!now) throw new Error("Database clock read failed.");
    return now;
  }

  private async insertEvent(
    client: PoolClient,
    handoffId: string,
    actor: string,
    eventType: HandoffEvent["eventType"],
    fromStatus: HandoffStatus | undefined,
    toStatus: HandoffStatus,
    note: string | undefined,
    createdAt: string,
  ): Promise<void> {
    await client.query(`
      INSERT INTO handoff_events (id, handoff_id, actor, event_type, from_status, to_status, note, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [randomUUID(), handoffId, actor, eventType, fromStatus ?? null, toStatus, note ?? null, createdAt]);
  }
}
