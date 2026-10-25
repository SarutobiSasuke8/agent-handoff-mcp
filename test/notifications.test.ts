import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { FileNotificationSink } from "../src/notifications.js";
import { HandoffStore } from "../src/store.js";

const input = {
  recipient: "recipient",
  title: "Private title",
  summary: "Private summary",
  request: "Private request",
  contextRefs: ["private/context"],
  artifactRefs: ["private/artifact"],
  tags: ["private-tag"],
  sensitivity: "internal" as const,
  priority: "normal" as const,
  idempotencyKey: "notification-test",
};

void test("notifications are off by default", () => {
  assert.equal(loadConfig({}).notificationFile, undefined);
});

void test("new handoffs emit one metadata-only notice; retries emit none", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "handoff-notification-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "nested", "notices.jsonl");
  const store = new HandoffStore(":memory:");
  t.after(() => store.close());
  const sink = new FileNotificationSink(file);

  const first = store.create("sender", input, 8, sink);
  const duplicate = store.create("sender", input, 8, sink);
  assert.equal(duplicate.id, first.id);
  const lines = readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const notice = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(notice).sort(), ["handoffId", "recipientId", "senderId", "status", "timestamp"]);
  assert.deepEqual(notice, {
    handoffId: first.id,
    senderId: "sender",
    recipientId: "recipient",
    status: "queued",
    timestamp: first.createdAt,
  });
  for (const privateField of ["title", "summary", "request", "contextRefs", "artifactRefs", "tags", "sensitivity", "priority"]) {
    assert.equal(privateField in notice, false);
  }
});
