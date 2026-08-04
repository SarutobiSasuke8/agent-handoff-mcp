import assert from "node:assert/strict";
import test from "node:test";

import { HandoffStore } from "../src/store.js";

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
