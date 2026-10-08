#!/usr/bin/env node
/**
 * Run the Agent Handoff Board review test cases (5 positive, 3 negative) against a running
 * server that was seeded with scripts/board-demo-seed.mjs on a fresh database.
 *
 * These are the protocol-level checks behind docs/board/test-cases.md: they call the same
 * six MCP tools the plugin skills use, over Streamable HTTP with the demo bearer tokens.
 * They do not exercise ChatGPT or Codex themselves.
 *
 * Usage:
 *   node scripts/board-test-cases.mjs --url http://127.0.0.1:3220/mcp --tokens <tokens.json>
 *
 * Needs a source checkout with dev dependencies installed (@modelcontextprotocol/client).
 * Creates a few extra handoffs in the demo workspace; run it on a disposable volume.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const { values } = parseArgs({
  options: { url: { type: "string" }, tokens: { type: "string" } },
  strict: true,
});
if (!values.url || !values.tokens) {
  process.stderr.write("Usage: node scripts/board-test-cases.mjs --url <http(s)://host/mcp> --tokens <tokens.json>\n");
  process.exit(2);
}
const url = new URL(values.url);
const tokens = JSON.parse(readFileSync(values.tokens, "utf8"));
const runId = `${Date.now().toString(36)}`;

async function connect(agentId) {
  const client = new Client({ name: "board-test-cases", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${tokens[agentId]}` } },
  });
  await client.connect(transport);
  return {
    close: () => client.close(),
    call: async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content ?? []).map((item) => item.text ?? "").join("\n");
      return { ok: result.isError !== true, text, value: result.isError ? undefined : (result.structuredContent ?? JSON.parse(text)) };
    },
  };
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const results = [];
async function runCase(id, title, body) {
  try {
    const detail = await body();
    results.push({ id, title, pass: true, detail });
  } catch (error) {
    results.push({ id, title, pass: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

const operator = await connect("demo-operator");
const planner = await connect("demo-planner");
const coder = await connect("demo-coder");
const reviewer = await connect("demo-reviewer");

let created;

await runCase("P1", "Create: operator hands work to the coder agent (handoff_send)", async () => {
  const sent = await operator.call("handoff_send", {
    recipient: "demo-coder",
    title: "Add a /version endpoint",
    summary: "Clients need to read the running build version.",
    request: "Add GET /version returning the package version. Done when a test covers it.",
    context_refs: ["issue:demo/agent-service#51"],
    priority: "high",
    idempotency_key: `board-p1-${runId}`,
  });
  expect(sent.ok, `send failed: ${sent.text}`);
  created = sent.value.handoff;
  expect(created.status === "queued" && created.sender === "demo-operator" && created.recipient === "demo-coder", "unexpected handoff fields");
  const retry = await operator.call("handoff_send", {
    recipient: "demo-coder",
    title: "Add a /version endpoint",
    summary: "Clients need to read the running build version.",
    request: "Add GET /version returning the package version. Done when a test covers it.",
    context_refs: ["issue:demo/agent-service#51"],
    priority: "high",
    idempotency_key: `board-p1-${runId}`,
  });
  expect(retry.ok && retry.value.handoff.id === created.id, "idempotent retry created a duplicate");
  return `queued ${created.id}; idempotent retry returned the same id`;
});

await runCase("P2", "Review: coder inbox lists new and seeded work; history readable (handoff_inbox, handoff_get)", async () => {
  const inbox = await coder.call("handoff_inbox", {});
  expect(inbox.ok, `inbox failed: ${inbox.text}`);
  const titles = inbox.value.handoffs.map((handoff) => `${handoff.status}:${handoff.title}`);
  expect(inbox.value.handoffs.some((handoff) => handoff.id === created.id), "new handoff missing from inbox");
  expect(titles.includes("blocked:Rotate the staging service credentials"), `seeded blocked handoff missing: ${titles.join(", ")}`);
  const got = await coder.call("handoff_get", { handoff_id: created.id });
  expect(got.ok && got.value.events.length === 1 && got.value.events[0].eventType === "created", "unexpected event history");
  return `inbox has ${inbox.value.handoffs.length} open handoffs incl. seeded blocked one; 1 created event`;
});

await runCase("P3", "Accept: coder accepts the queued handoff (handoff_acknowledge)", async () => {
  const accepted = await coder.call("handoff_acknowledge", { handoff_id: created.id, note: "On it today." });
  expect(accepted.ok && accepted.value.handoff.status === "accepted", `accept failed: ${accepted.text}`);
  return "status accepted";
});

await runCase("P4", "Close: coder completes it; sender sees the full audit trail (handoff_update_status)", async () => {
  const done = await coder.call("handoff_update_status", { handoff_id: created.id, status: "completed", note: "Merged; test added." });
  expect(done.ok && done.value.handoff.status === "completed", `complete failed: ${done.text}`);
  const history = await operator.call("handoff_get", { handoff_id: created.id });
  const trail = history.value.events.map((event) => `${event.actor}:${event.eventType}`).join(" > ");
  expect(trail === "demo-operator:created > demo-coder:accepted > demo-coder:completed", `unexpected trail ${trail}`);
  return trail;
});

await runCase("P5", "Close: sender cancels a still-queued handoff; it leaves the open inbox", async () => {
  const sent = await operator.call("handoff_send", {
    recipient: "demo-reviewer",
    title: "Proofread the README",
    summary: "Short proofreading pass.",
    request: "Fix typos only.",
    sensitivity: "public-safe",
  });
  expect(sent.ok, `send failed: ${sent.text}`);
  const cancelled = await operator.call("handoff_update_status", { handoff_id: sent.value.handoff.id, status: "cancelled", note: "No longer needed." });
  expect(cancelled.ok && cancelled.value.handoff.status === "cancelled", `cancel failed: ${cancelled.text}`);
  const inbox = await reviewer.call("handoff_inbox", {});
  expect(!inbox.value.handoffs.some((handoff) => handoff.id === sent.value.handoff.id), "cancelled handoff still in the open inbox");
  return "status cancelled; not in reviewer's open inbox";
});

await runCase("N1", "Denied: planner sends to an identity outside its send_to list", async () => {
  const denied = await planner.call("handoff_send", {
    recipient: "demo-reviewer",
    title: "Skip the coder and review directly",
    summary: "Attempt outside policy.",
    request: "Review this.",
  });
  expect(!denied.ok, "send outside policy was accepted");
  return `refused: ${denied.text}`;
});

await runCase("N2", "Denied: reviewer reads a handoff it is not party to", async () => {
  const denied = await reviewer.call("handoff_get", { handoff_id: created.id });
  expect(!denied.ok && /not found or is not accessible/u.test(denied.text), `unexpected result: ${denied.text}`);
  return `refused: ${denied.text}`;
});

await runCase("N3", "Denied: requests with no token or an invalid token get HTTP 401", async () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const none = await fetch(url, { method: "POST", headers, body });
  const bad = await fetch(url, { method: "POST", headers: { ...headers, authorization: "Bearer handoff_not-a-real-token" }, body });
  expect(none.status === 401 && bad.status === 401, `got ${none.status} and ${bad.status}`);
  return `no token ${none.status}; invalid token ${bad.status}`;
});

await Promise.all([operator, planner, coder, reviewer].map((session) => session.close()));

for (const result of results) {
  process.stdout.write(`${result.pass ? "PASS" : "FAIL"} ${result.id} ${result.title}\n     ${result.detail}\n`);
}
const failed = results.filter((result) => !result.pass).length;
process.stdout.write(`\n${results.length - failed}/${results.length} cases passed.\n`);
process.exit(failed ? 1 : 0);
