import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { HandoffStore } from "../src/store.js";
import { CURRENT_SCHEMA_VERSION } from "../src/migrations.js";

void test("schema migrations are recorded, idempotent and refuse a newer store", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "handoff-migrations-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "handoffs.sqlite");
  new HandoffStore(file).close();
  let db = new DatabaseSync(file);
  assert.deepEqual(
    (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[]).map((row) => row.version),
    [1, CURRENT_SCHEMA_VERSION],
  );
  db.close();
  new HandoffStore(file).close();
  db = new DatabaseSync(file);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()!.count, 2);
  db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(CURRENT_SCHEMA_VERSION + 1, new Date().toISOString());
  db.close();
  assert.throws(() => new HandoffStore(file), /newer than this binary/u);
});

void test("unversioned existing store is recorded without losing handoffs", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "handoff-legacy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "handoffs.sqlite");
  const old = new HandoffStore(file);
  const handoff = old.create("claude", input, 8);
  old.close();
  const db = new DatabaseSync(file);
  db.exec("DROP TABLE schema_migrations");
  db.close();
  const reopened = new HandoffStore(file);
  assert.equal(reopened.get(handoff.id).id, handoff.id);
  reopened.close();
  const migrated = new DatabaseSync(file);
  assert.equal(migrated.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()!.version, CURRENT_SCHEMA_VERSION);
  migrated.close();
});

void test("version 1 store gains payload hashes once and preserves rows", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "handoff-v1-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "handoffs.sqlite");
  const old = new HandoffStore(file);
  const handoff = old.create("claude", { ...input, idempotencyKey: "v1-upgrade" }, 8);
  old.close();
  const db = new DatabaseSync(file);
  db.exec("ALTER TABLE handoffs DROP COLUMN payload_hash; DELETE FROM schema_migrations WHERE version = 2");
  db.close();
  const upgraded = new HandoffStore(file);
  assert.equal(upgraded.get(handoff.id).id, handoff.id);
  upgraded.close();
  const migrated = new DatabaseSync(file);
  assert.equal(migrated.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()!.version, CURRENT_SCHEMA_VERSION);
  assert.ok((migrated.prepare("SELECT name FROM pragma_table_info('handoffs')").all() as { name: string }[])
    .some((column) => column.name === "payload_hash"));
  migrated.close();
});

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
  idempotencyKey: "review-protocol-v1",
};

void test("store creates idempotent handoffs and records lifecycle events", () => {
  const store = new HandoffStore(":memory:");
  try {
    const first = store.create("claude", input, 8);
    const duplicate = store.create("claude", input, 8);
    assert.equal(duplicate.id, first.id);
    assert.equal(store.inbox("codex", ["queued"], 20).length, 1);

    const accepted = store.transition(first.id, "codex", "accepted", "Taking this.");
    assert.equal(accepted.status, "accepted");
    const completed = store.transition(first.id, "codex", "completed", "Checked.");
    assert.equal(completed.status, "completed");
    assert.deepEqual(store.events(first.id).map((event) => event.eventType), ["created", "accepted", "completed"]);
  } finally {
    store.close();
  }
});

void test("store rejects a reused idempotency key with a different payload", () => {
  const store = new HandoffStore(":memory:");
  try {
    const first = store.create("claude", input, 8);
    assert.throws(
      () => store.create("claude", { ...input, title: "A different title" }, 8),
      /already used by 'claude' with a different payload/u,
    );
    assert.throws(
      () => store.create("claude", { ...input, recipient: "nezu" }, 8),
      /already used by 'claude' with a different payload/u,
    );
    // The identical payload still replays idempotently after a rejected mismatch.
    assert.equal(store.create("claude", input, 8).id, first.id);
    assert.equal(store.inbox("codex", ["queued"], 20).length, 1);
    // A different sender may reuse the same key without conflict.
    const other = store.create("codex", { ...input, recipient: "claude" }, 8);
    assert.notEqual(other.id, first.id);
  } finally {
    store.close();
  }
});

void test("store enforces actor-specific state transitions", () => {
  const store = new HandoffStore(":memory:");
  try {
    const handoff = store.create("claude", { ...input, idempotencyKey: "transition-test" }, 8);
    assert.throws(() => store.transition(handoff.id, "claude", "completed"), /may not move/u);
    assert.throws(() => store.transition(handoff.id, "codex", "completed"), /may not move/u);
    assert.equal(store.transition(handoff.id, "claude", "cancelled").status, "cancelled");
  } finally {
    store.close();
  }
});

void test("store caps reply-chain depth", () => {
  const store = new HandoffStore(":memory:");
  try {
    const parent = store.create("claude", { ...input, idempotencyKey: "depth-parent" }, 0);
    assert.throws(
      () => store.create("codex", {
        ...input,
        recipient: "claude",
        parentId: parent.id,
        idempotencyKey: "depth-child",
      }, 0),
      /Maximum handoff depth/u,
    );
  } finally {
    store.close();
  }
});
