import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, describe, test } from "node:test";

import { loadConfig } from "../src/config.js";
import { CURRENT_SCHEMA_VERSION } from "../src/migrations.js";
import { POSTGRES_MIGRATIONS } from "../src/migrations-postgres.js";
import { createStore } from "../src/runtime.js";
import { HandoffStore } from "../src/store.js";
import { PostgresHandoffStore } from "../src/store-postgres.js";

import type { HandoffStoreAdapter } from "../src/store-adapter.js";

// Postgres tests run only against a local, throwaway database named by
// HANDOFF_PG_URL. Each suite uses its own schema and drops it afterwards.
const PG_URL = process.env.HANDOFF_PG_URL;
const pgDescribe = PG_URL ? describe : describe.skip;

const input = {
  recipient: "codex",
  title: "Review the protocol",
  summary: "Check the public contract.",
  request: "Confirm lifecycle and authorization boundaries.",
  contextRefs: ["docs/PROTOCOL.md"],
  artifactRefs: [],
  tags: ["review"],
  sensitivity: "internal" as const,
  priority: "normal" as const,
};

void test("Postgres migrations stay in step with the SQLite schema version", () => {
  assert.equal(POSTGRES_MIGRATIONS.length, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(POSTGRES_MIGRATIONS.map((migration) => migration.version), Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, index) => index + 1));
});

void test("store selection defaults to SQLite and Postgres requires a URL", () => {
  const config = loadConfig({ HANDOFF_MCP_DB: ":memory:" });
  assert.equal(config.storeKind, "sqlite");
  assert.equal(config.postgresUrl, undefined);
  assert.throws(() => loadConfig({ HANDOFF_STORE: "postgres" }), /requires HANDOFF_PG_URL/u);
  assert.throws(() => loadConfig({ HANDOFF_STORE: "mysql" }));
  const sqlite = createStore({ ...config, databaseFile: ":memory:" });
  try {
    assert.ok(sqlite instanceof HandoffStore);
  } finally {
    void sqlite.close();
  }
});

/** The behavioural contract every adapter must meet, exercised through the async interface. */
function contract(name: string, open: () => Promise<HandoffStoreAdapter>): void {
  void test(`${name}: idempotent create, lifecycle and audit trail`, async () => {
    const store = await open();
    try {
      await store.ready();
      const first = await store.create("claude", { ...input, idempotencyKey: "contract-1" }, 8);
      const duplicate = await store.create("claude", { ...input, idempotencyKey: "contract-1" }, 8);
      assert.equal(duplicate.id, first.id);
      assert.equal(first.status, "queued");
      assert.equal(first.threadId, first.id);
      assert.match(first.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
      await assert.rejects(
        async () => store.create("claude", { ...input, idempotencyKey: "contract-1", title: "Other" }, 8),
        /already used by 'claude' with a different payload/u,
      );
      assert.equal((await store.inbox("codex", ["queued"], 20)).length, 1);

      await assert.rejects(async () => store.transition(first.id, "claude", "completed"), /may not move/u);
      assert.equal((await store.transition(first.id, "codex", "accepted", "Taking this.")).status, "accepted");
      await assert.rejects(async () => store.transition(first.id, "codex", "accepted"), /may not move 'accepted' to 'accepted'/u);
      assert.equal((await store.transition(first.id, "codex", "blocked", "Waiting.")).status, "blocked");
      assert.equal((await store.transition(first.id, "codex", "completed", "Done.")).status, "completed");

      const events = await store.events(first.id);
      assert.deepEqual(events.map((event) => event.eventType), ["created", "accepted", "blocked", "completed"]);
      assert.deepEqual(events.map((event) => event.fromStatus ?? null), [null, "queued", "accepted", "blocked"]);
      assert.deepEqual(events.map((event) => event.note ?? null), [null, "Taking this.", "Waiting.", "Done."]);
      assert.ok(events.every((event) => event.handoffId === first.id));

      const child = await store.create("codex", { ...input, recipient: "claude", parentId: first.id }, 8);
      assert.equal(child.depth, 1);
      assert.equal(child.threadId, first.id);
      await assert.rejects(async () => store.create("claude", { ...input, parentId: child.id }, 1), /Maximum handoff depth/u);
      await assert.rejects(async () => store.get("missing"), /was not found/u);
      assert.equal(await store.find("missing"), undefined);
    } finally {
      await store.close();
    }
  });
}

contract("sqlite", async () => new HandoffStore(":memory:"));

void pgDescribe("postgres adapter (local container only)", () => {
  const schemas: string[] = [];
  const newSchema = (): string => {
    const schema = `handoff_test_${randomBytes(6).toString("hex")}`;
    schemas.push(schema);
    return schema;
  };
  const openPg = (schema: string): PostgresHandoffStore => new PostgresHandoffStore({ connectionString: PG_URL!, schema });

  after(async () => {
    const pg = (await import("pg")).default;
    const pool = new pg.Pool({ connectionString: PG_URL! });
    try {
      for (const schema of schemas) await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
    }
  });

  contract("postgres", async () => openPg(newSchema()));

  void test("concurrent hosts migrate exactly once", async () => {
    const schema = newSchema();
    const hosts = [openPg(schema), openPg(schema), openPg(schema)];
    try {
      await Promise.all(hosts.map(async (host) => host.ready()));
      const pg = (await import("pg")).default;
      const pool = new pg.Pool({ connectionString: PG_URL! });
      pool.on("connect", (client) => { client.query(`SET search_path TO ${schema}`).catch(() => undefined); });
      try {
        const versions = await pool.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version");
        assert.deepEqual(versions.rows.map((row) => row.version), POSTGRES_MIGRATIONS.map((migration) => migration.version));
        await pool.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)", [CURRENT_SCHEMA_VERSION + 1, new Date().toISOString()]);
      } finally {
        await pool.end();
      }
      const newer = openPg(schema);
      await assert.rejects(async () => newer.ready(), /newer than this binary/u);
      await newer.close();
    } finally {
      await Promise.all(hosts.map(async (host) => host.close()));
    }
  });

  void test("two hosts acknowledging one handoff: exactly one wins, one audit event", async () => {
    const schema = newSchema();
    const hostA = openPg(schema);
    const hostB = openPg(schema);
    try {
      await hostA.ready();
      await hostB.ready();
      for (let round = 0; round < 10; round += 1) {
        const handoff = await hostA.create("claude", input, 8);
        const results = await Promise.allSettled([
          hostA.transition(handoff.id, "codex", "accepted", "host A"),
          hostB.transition(handoff.id, "codex", "accepted", "host B"),
        ]);
        assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
        const rejected = results.find((result) => result.status === "rejected");
        assert.match(String(rejected?.reason), /may not move 'accepted' to 'accepted'/u);
        const events = await hostB.events(handoff.id);
        assert.deepEqual(events.map((event) => event.eventType), ["created", "accepted"]);
      }
    } finally {
      await hostA.close();
      await hostB.close();
    }
  });

  void test("concurrent retries of one idempotency key create one handoff", async () => {
    const schema = newSchema();
    const hostA = openPg(schema);
    const hostB = openPg(schema);
    try {
      await hostA.ready();
      await hostB.ready();
      const sent = await Promise.all([
        hostA.create("claude", { ...input, idempotencyKey: "race" }, 8),
        hostB.create("claude", { ...input, idempotencyKey: "race" }, 8),
        hostA.create("claude", { ...input, idempotencyKey: "race" }, 8),
      ]);
      assert.equal(new Set(sent.map((handoff) => handoff.id)).size, 1);
      assert.equal((await hostB.inbox("codex", ["queued"], 20)).length, 1);
      assert.deepEqual((await hostA.events(sent[0]!.id)).map((event) => event.eventType), ["created"]);
    } finally {
      await hostA.close();
      await hostB.close();
    }
  });
});
