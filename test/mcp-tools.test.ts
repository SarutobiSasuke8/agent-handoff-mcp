import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { DomainError } from "../src/errors.js";
import { createHandoffMcpServer } from "../src/server.js";
import { HandoffService } from "../src/service.js";
import { HandoffStore } from "../src/store.js";
import { AgentRegistry } from "../src/registry.js";

import type { McpServer } from "@modelcontextprotocol/server";

const TOOLS = [
  "handoff_whoami",
  "handoff_send",
  "handoff_inbox",
  "handoff_get",
  "handoff_acknowledge",
  "handoff_update_status",
] as const;

const registryYaml = `
version: 1
agents:
  - id: claude
    display_name: Claude
    enabled: true
    send_to: [codex]
    receive_from: [codex]
    disclosure_ceiling: internal
  - id: codex
    display_name: Codex
    enabled: true
    send_to: [claude]
    receive_from: [claude]
    disclosure_ceiling: internal
  - id: observer
    display_name: Observer
    enabled: true
    send_to: []
    receive_from: []
    disclosure_ceiling: public-safe
`;

interface Outcome {
  ok: boolean;
  text: string;
  value?: Record<string, unknown>;
}

interface Session {
  call: (name: string, args?: Record<string, unknown>) => Promise<Outcome>;
  listTools: () => Promise<string[]>;
  close: () => Promise<void>;
}

let clock = 0;

async function openSession(service: HandoffService, agentId?: string): Promise<Session> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server: McpServer = createHandoffMcpServer(service, agentId);
  await server.connect(serverTransport);
  const client = new Client({ name: `in-process-${agentId ?? "anonymous"}`, version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    call: (name, args = {}) => callTool(client, name, args),
    listTools: async () => {
      const listed = await client.listTools();
      return listed.tools.map((tool) => tool.name);
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<Outcome> {
  try {
    const result = await client.callTool({ name, arguments: args });
    const isError = result.isError === true;
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((item) => (typeof item === "object" && item !== null && "text" in item ? String((item as { text: unknown }).text) : ""))
      .join("\n");
    return {
      ok: !isError,
      text,
      ...(isError ? {} : { value: (result.structuredContent ?? JSON.parse(text)) as Record<string, unknown> }),
    };
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) };
  }
}

async function fixture(t: { after: (fn: () => Promise<void>) => void }): Promise<{ service: HandoffService; claude: Session; codex: Session }> {
  const temp = await mkdtemp(path.join(os.tmpdir(), "handoff-mcp-tools-"));
  const registryFile = path.join(temp, "agents.yaml");
  await writeFile(registryFile, registryYaml, "utf8");
  clock += 1;
  const when = new Date(Date.now() - 60_000 + clock * 1000);
  await utimes(registryFile, when, when);
  const store = new HandoffStore(":memory:");
  const service = new HandoffService(new AgentRegistry(registryFile), store, {
    maxMessageBytes: 32_768,
    maxHandoffDepth: 8,
  });
  const claude = await openSession(service, "claude");
  const codex = await openSession(service, "codex");
  t.after(async () => {
    await claude.close();
    await codex.close();
    store.close();
    await rm(temp, { recursive: true, force: true });
  });
  return { service, claude, codex };
}

function sendArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recipient: "codex",
    title: "Review the handoff",
    summary: "A bounded summary.",
    request: "Return a decision.",
    ...overrides,
  };
}

void test("in-process client lists every registered tool", async (t) => {
  const { claude } = await fixture(t);
  const names = await claude.listTools();
  assert.deepEqual([...names].sort(), [...TOOLS].sort());
});

void test("schema validation rejects malformed input for every tool", async (t) => {
  const { claude } = await fixture(t);
  const cases: Array<[string, Record<string, unknown>]> = [
    ["handoff_whoami", { extra: true }],
    ["handoff_send", sendArgs({ recipient: "BAD ID" })],
    ["handoff_send", sendArgs({ sensitivty: "internal" })],
    ["handoff_send", { recipient: "codex", title: "T", summary: "S" }],
    ["handoff_send", sendArgs({ sensitivity: "secret" })],
    ["handoff_send", sendArgs({ title: "x".repeat(161) })],
    ["handoff_inbox", { limit: 0 }],
    ["handoff_inbox", { limit: 101 }],
    ["handoff_inbox", { statuses: ["nope"] }],
    ["handoff_inbox", { unexpected: 1 }],
    ["handoff_get", {}],
    ["handoff_get", { handoff_id: "not-a-uuid" }],
    ["handoff_acknowledge", { handoff_id: "not-a-uuid" }],
    ["handoff_acknowledge", { handoff_id: "00000000-0000-4000-8000-000000000000", note: "n".repeat(501) }],
    ["handoff_update_status", { handoff_id: "00000000-0000-4000-8000-000000000000", status: "queued" }],
    ["handoff_update_status", { handoff_id: "not-a-uuid", status: "completed" }],
    ["handoff_update_status", { status: "cancelled" }],
  ];
  for (const [name, args] of cases) {
    const result = await claude.call(name, args);
    assert.equal(result.ok, false, `${name} should reject ${JSON.stringify(args)} but returned ${result.text}`);
  }
});

void test("in-process round trip covers happy paths for every tool", async (t) => {
  const { claude, codex } = await fixture(t);

  const who = await claude.call("handoff_whoami");
  assert.equal(who.ok, true, who.text);
  assert.equal(who.value?.agent_id, "claude");
  assert.equal(who.value?.display_name, "Claude");
  assert.equal(who.value?.disclosure_ceiling, "internal");
  assert.ok(typeof who.value?.policy_revision === "string");

  const firstSend = sendArgs({
    context_refs: ["note://brief"],
    artifact_refs: ["file://diff"],
    tags: ["review"],
    sensitivity: "internal",
    priority: "high",
    idempotency_key: "idem-key-01",
  });
  const sent = await claude.call("handoff_send", firstSend);
  assert.equal(sent.ok, true, sent.text);
  const handoff = sent.value?.handoff as { id: string; status: string; priority: string; tags: string[] };
  assert.equal(handoff.status, "queued");
  assert.equal(handoff.priority, "high");
  assert.deepEqual(handoff.tags, ["review"]);

  const replay = await claude.call("handoff_send", firstSend);
  assert.equal(replay.ok, true, replay.text);
  assert.equal((replay.value?.handoff as { id: string }).id, handoff.id);

  const reply = await codex.call("handoff_send", {
    recipient: "claude",
    title: "Reply",
    summary: "Reply summary.",
    request: "Noted.",
    parent_id: handoff.id,
  });
  assert.equal(reply.ok, true, reply.text);
  assert.equal((reply.value?.handoff as { parentId?: string }).parentId, handoff.id);

  const inbox = await codex.call("handoff_inbox", { statuses: ["queued"], limit: 5 });
  assert.equal(inbox.ok, true, inbox.text);
  assert.equal((inbox.value?.handoffs as unknown[]).length, 1);

  const read = await codex.call("handoff_get", { handoff_id: handoff.id });
  assert.equal(read.ok, true, read.text);
  assert.ok(Array.isArray((read.value?.events as unknown[])));
  assert.ok((read.value?.events as unknown[]).length >= 1);

  const accepted = await codex.call("handoff_acknowledge", { handoff_id: handoff.id, note: "Taking this." });
  assert.equal(accepted.ok, true, accepted.text);
  assert.equal((accepted.value?.handoff as { status: string }).status, "accepted");

  const blocked = await codex.call("handoff_update_status", { handoff_id: handoff.id, status: "blocked", note: "Waiting." });
  assert.equal(blocked.ok, true, blocked.text);
  assert.equal((blocked.value?.handoff as { status: string }).status, "blocked");

  const done = await codex.call("handoff_update_status", { handoff_id: handoff.id, status: "completed" });
  assert.equal(done.ok, true, done.text);
  assert.equal((done.value?.handoff as { status: string }).status, "completed");

  const cancelable = await claude.call("handoff_send", sendArgs({ title: "Cancel me", idempotency_key: "idem-key-02" }));
  assert.equal(cancelable.ok, true, cancelable.text);
  const cancelId = (cancelable.value?.handoff as { id: string }).id;
  const cancelled = await claude.call("handoff_update_status", { handoff_id: cancelId, status: "cancelled", note: "No longer needed." });
  assert.equal(cancelled.ok, true, cancelled.text);
  assert.equal((cancelled.value?.handoff as { status: string }).status, "cancelled");

  const defaults = await claude.call("handoff_send", sendArgs({ title: "Defaults" }));
  assert.equal(defaults.ok, true, defaults.text);
  const created = defaults.value?.handoff as { sensitivity: string; priority: string; contextRefs: string[] };
  assert.equal(created.sensitivity, "internal");
  assert.equal(created.priority, "normal");
  assert.deepEqual(created.contextRefs, []);

  const defaultInbox = await codex.call("handoff_inbox");
  assert.equal(defaultInbox.ok, true, defaultInbox.text);
  assert.ok(Array.isArray(defaultInbox.value?.handoffs));
});

void test("in-process client surfaces domain errors for every mutating tool", async (t) => {
  const { claude, codex } = await fixture(t);
  const missing = "00000000-0000-4000-8000-000000000000";

  const denied = await claude.call("handoff_send", sendArgs({ recipient: "observer" }));
  assert.equal(denied.ok, false);
  assert.match(denied.text, /may not send/u);

  const sent = await claude.call("handoff_send", sendArgs({ idempotency_key: "idem-key-09" }));
  assert.equal(sent.ok, true, sent.text);
  const id = (sent.value?.handoff as { id: string }).id;

  const senderAck = await claude.call("handoff_acknowledge", { handoff_id: id });
  assert.equal(senderAck.ok, false);
  assert.match(senderAck.text, /may not move/u);

  const missingGet = await codex.call("handoff_get", { handoff_id: missing });
  assert.equal(missingGet.ok, false);
  assert.match(missingGet.text, /not found or is not accessible/u);

  const reused = await claude.call("handoff_send", sendArgs({ title: "Changed title", idempotency_key: "idem-key-09" }));
  assert.equal(reused.ok, false);
  assert.match(reused.text, /idempotency/iu);

  const earlyComplete = await codex.call("handoff_update_status", { handoff_id: id, status: "completed" });
  assert.equal(earlyComplete.ok, false);
  assert.match(earlyComplete.text, /may not move/u);

  const parentDenied = await claude.call("handoff_send", sendArgs({ parent_id: missing }));
  assert.equal(parentDenied.ok, false);
  assert.match(parentDenied.text, /not found or is not accessible/u);
});

void test("a session without an agent identity is rejected", async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "handoff-mcp-anon-"));
  const registryFile = path.join(temp, "agents.yaml");
  await writeFile(registryFile, registryYaml, "utf8");
  const store = new HandoffStore(":memory:");
  const service = new HandoffService(new AgentRegistry(registryFile), store, {
    maxMessageBytes: 32_768,
    maxHandoffDepth: 8,
  });
  const anonymous = await openSession(service);
  t.after(async () => {
    await anonymous.close();
    store.close();
    await rm(temp, { recursive: true, force: true });
  });
  for (const name of TOOLS) {
    const args = name === "handoff_send"
      ? sendArgs()
      : name === "handoff_get" || name === "handoff_acknowledge"
        ? { handoff_id: "00000000-0000-4000-8000-000000000000" }
        : name === "handoff_update_status"
          ? { handoff_id: "00000000-0000-4000-8000-000000000000", status: "cancelled" }
          : {};
    const result = await anonymous.call(name, args);
    assert.equal(result.ok, false, name);
    assert.match(result.text, /identity is missing/u);
  }
});

void test("unexpected tool failures stay generic and do not leak internals", async (t) => {
  const exploding = {
    whoami: () => {
      throw new Error("sqlite open failed at /secret/handoffs.sqlite");
    },
    send: () => {
      throw new DomainError("should not be reached");
    },
  } as unknown as HandoffService;
  const session = await openSession(exploding, "claude");
  t.after(async () => {
    await session.close();
  });
  const result = await session.call("handoff_whoami");
  assert.equal(result.ok, false);
  assert.equal(result.text, "An internal error occurred while processing this request.");
  assert.equal(result.text.includes("/secret/"), false);
});
