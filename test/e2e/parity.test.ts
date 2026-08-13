import assert from "node:assert/strict";
import test from "node:test";

import { TOOL_NAMES, createFixture, startHttpHarness, startStdioSession } from "./harness.js";

import type { AgentSpec, Fixture, Session } from "./harness.js";

// alpha and beta are the two authorised principals. gamma has a public-safe
// ceiling, loner has no relationships, expired has an expired credential.
function baseAgents(): AgentSpec[] {
  return [
    { id: "alpha", sendTo: ["beta", "gamma"], receiveFrom: ["beta"] },
    { id: "beta", sendTo: ["alpha"], receiveFrom: ["alpha"] },
    { id: "gamma", sendTo: [], receiveFrom: ["alpha"], ceiling: "public-safe" },
    { id: "loner", sendTo: [], receiveFrom: [] },
    { id: "expired", sendTo: ["alpha"], receiveFrom: [], expiresAt: "2020-01-01T00:00:00Z" },
  ];
}

function sendArgs(recipient: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recipient,
    title: "Parity check",
    summary: "Cross-transport scenario.",
    request: "Confirm behaviour matches on both transports.",
    ...overrides,
  };
}

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

type SessionFactory = (agentId: string) => Promise<Session>;

async function runParityScenarios(fixture: Fixture, sessions: SessionFactory, transport: string): Promise<void> {
  const alpha = await sessions("alpha");
  const beta = await sessions("beta");
  try {
    // Initialize and tool metadata.
    const tools = await alpha.client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort(), transport);

    // whoami carries the policy snapshot revision as evidence.
    const who = await alpha.call("handoff_whoami");
    assert.ok(who.ok, `${transport}: ${who.text}`);
    assert.equal(who.value?.agent_id, "alpha");
    assert.ok(typeof who.value?.policy_revision === "string" && (who.value.policy_revision as string).length > 0);

    // Unknown argument keys are rejected, not silently dropped.
    const typo = await alpha.call("handoff_send", sendArgs("beta", { sensitivty: "internal" }));
    assert.ok(!typo.ok, `${transport}: misspelled argument must be rejected`);

    // Denied sends: unrelated recipient, wrong direction, over-ceiling, unprovisioned.
    for (const [label, args] of [
      ["unrelated", sendArgs("loner")],
      ["over-ceiling", sendArgs("gamma", { sensitivity: "internal" })],
      ["unprovisioned", sendArgs("nobody")],
    ] as const) {
      const denied = await alpha.call("handoff_send", args);
      assert.ok(!denied.ok, `${transport}: ${label} send must be denied`);
    }
    const wrongDirection = await beta.call("handoff_send", sendArgs("gamma"));
    assert.ok(!wrongDirection.ok, `${transport}: wrong-direction send must be denied`);

    // Full allowed lifecycle between the two authorised principals.
    const sent = await alpha.call("handoff_send", sendArgs("beta"));
    assert.ok(sent.ok, `${transport}: ${sent.text}`);
    const handoffId = (sent.value?.handoff as { id: string }).id;
    const inbox = await beta.call("handoff_inbox", {});
    assert.ok(inbox.ok);
    assert.equal((inbox.value?.handoffs as unknown[]).length, 1, transport);
    const read = await beta.call("handoff_get", { handoff_id: handoffId });
    assert.ok(read.ok);
    const acknowledged = await beta.call("handoff_acknowledge", { handoff_id: handoffId, note: "Taking this." });
    assert.ok(acknowledged.ok);
    const completed = await beta.call("handoff_update_status", { handoff_id: handoffId, status: "completed" });
    assert.ok(completed.ok);
    assert.equal((completed.value?.handoff as { status: string }).status, "completed");

    // Audit probe AHMCP-02: disable the recipient mid-session; the live session
    // must lose inbox, get, and acknowledge, not just whoami and send.
    const probe = await alpha.call("handoff_send", sendArgs("beta", { title: "Second" }));
    assert.ok(probe.ok);
    const probeId = (probe.value?.handoff as { id: string }).id;
    await fixture.writeRegistry(baseAgents().map((agent) => (agent.id === "beta" ? { ...agent, enabled: false } : agent)));
    for (const [name, args] of [
      ["handoff_whoami", {}],
      ["handoff_inbox", {}],
      ["handoff_get", { handoff_id: probeId }],
      ["handoff_acknowledge", { handoff_id: probeId }],
      ["handoff_update_status", { handoff_id: probeId, status: "completed" }],
    ] as const) {
      let denied: boolean;
      try {
        denied = !(await beta.call(name, args as Record<string, unknown>)).ok;
      } catch {
        denied = true; // HTTP revokes at the auth boundary; stdio at the tool boundary.
      }
      assert.ok(denied, `${transport}: disabled principal must be denied ${name}`);
    }

    // Mid-operation reload: restoring the registry restores the same session.
    await fixture.writeRegistry(baseAgents());
    const restored = await beta.call("handoff_whoami");
    assert.ok(restored.ok, `${transport}: session reuse after re-enable`);

    // Relationship removal denies historical reads with no existence oracle.
    await fixture.writeRegistry(baseAgents().map((agent) => (
      agent.id === "alpha" ? { ...agent, sendTo: ["gamma"] } : agent.id === "beta" ? { ...agent, receiveFrom: [] } : agent
    )));
    const removedRead = await beta.call("handoff_get", { handoff_id: probeId });
    assert.ok(!removedRead.ok, `${transport}: relationship removal must deny reads`);
    const missingRead = await beta.call("handoff_get", { handoff_id: MISSING_ID });
    assert.ok(!missingRead.ok);
    assert.equal(
      removedRead.text.replace(probeId, "<id>"),
      missingRead.text.replace(MISSING_ID, "<id>"),
      `${transport}: forbidden and missing handoffs must share one error shape`,
    );

    // Ceiling reduction denies historical reads of higher-sensitivity handoffs.
    await fixture.writeRegistry(baseAgents().map((agent) => (agent.id === "beta" ? { ...agent, ceiling: "public-safe" } : agent)));
    const ceilingRead = await beta.call("handoff_get", { handoff_id: probeId });
    assert.ok(!ceilingRead.ok, `${transport}: ceiling reduction must deny reads`);
    const ceilingInbox = await beta.call("handoff_inbox", {});
    assert.ok(ceilingInbox.ok);
    assert.equal((ceilingInbox.value?.handoffs as unknown[]).length, 0, `${transport}: over-ceiling items are filtered`);

    await fixture.writeRegistry(baseAgents());
  } finally {
    await alpha.close();
    await beta.close();
  }
}

void test("HTTP transport passes the revocation parity scenarios", async (t) => {
  const fixture = await createFixture(baseAgents());
  const harness = await startHttpHarness(fixture);
  t.after(async () => {
    await harness.close();
    await fixture.dispose();
  });
  await runParityScenarios(fixture, async (agentId) => harness.connect(fixture.tokens.get(agentId)!.token), "http");
});

void test("stdio transport passes the revocation parity scenarios", async (t) => {
  const fixture = await createFixture(baseAgents());
  t.after(async () => fixture.dispose());
  await runParityScenarios(fixture, async (agentId) => startStdioSession(fixture, agentId), "stdio");
});

void test("stdio refuses unprovisioned, disabled, and expired identities at startup", async (t) => {
  const fixture = await createFixture([
    ...baseAgents().map((agent) => (agent.id === "gamma" ? { ...agent, enabled: false } : agent)),
  ]);
  t.after(async () => fixture.dispose());
  for (const identity of ["nobody", "gamma", "expired"]) {
    await assert.rejects(
      startStdioSession(fixture, identity),
      `stdio server must refuse to start as '${identity}'`,
    );
  }
});

void test("HTTP rejects rotated, expired, disabled, and unknown tokens at the auth boundary", async (t) => {
  const fixture = await createFixture(baseAgents());
  const harness = await startHttpHarness(fixture);
  t.after(async () => {
    await harness.close();
    await fixture.dispose();
  });

  // Baseline session works.
  const before = await harness.connect(fixture.tokens.get("beta")!.token);
  assert.ok((await before.call("handoff_whoami")).ok);

  // Token rotation: replace beta's digest; the old raw token stops working
  // for both new connections and the already-open session.
  const oldToken = fixture.tokens.get("beta")!.token;
  const { newToken } = await import("../../src/provision.js");
  fixture.tokens.set("beta", newToken());
  await fixture.writeRegistry(baseAgents());
  await assert.rejects(async () => {
    const session = await harness.connect(oldToken);
    const outcome = await session.call("handoff_whoami");
    await session.close();
    if (!outcome.ok) throw new Error("denied");
  }, "rotated-away token must be rejected");
  await assert.rejects(async () => {
    const outcome = await before.call("handoff_whoami");
    if (!outcome.ok) throw new Error("denied");
  }, "existing session must lose access after rotation");
  await before.close().catch(() => undefined);

  const fresh = await harness.connect(fixture.tokens.get("beta")!.token);
  assert.ok((await fresh.call("handoff_whoami")).ok, "rotated token must work");
  await fresh.close();

  // Expired credential and unknown token.
  await assert.rejects(async () => {
    const session = await harness.connect(fixture.tokens.get("expired")!.token);
    const outcome = await session.call("handoff_whoami");
    await session.close();
    if (!outcome.ok) throw new Error("denied");
  });
  await assert.rejects(async () => {
    const session = await harness.connect("handoff_not-a-real-token");
    const outcome = await session.call("handoff_whoami");
    await session.close();
    if (!outcome.ok) throw new Error("denied");
  });
});

void test("handoffs persist across a server restart on both transports", async (t) => {
  const fixture = await createFixture(baseAgents());
  t.after(async () => fixture.dispose());

  // First HTTP server instance records a handoff.
  let harness = await startHttpHarness(fixture);
  const alpha = await harness.connect(fixture.tokens.get("alpha")!.token);
  const sent = await alpha.call("handoff_send", sendArgs("beta", { idempotency_key: "restart-persistence" }));
  assert.ok(sent.ok, sent.text);
  await alpha.close();
  await harness.close();

  // A fresh HTTP server over the same database still serves it.
  harness = await startHttpHarness(fixture);
  const betaHttp = await harness.connect(fixture.tokens.get("beta")!.token);
  const inboxHttp = await betaHttp.call("handoff_inbox", {});
  assert.equal((inboxHttp.value?.handoffs as unknown[]).length, 1);
  await betaHttp.close();
  await harness.close();

  // A separate stdio process over the same database sees the same state.
  const betaStdio = await startStdioSession(fixture, "beta");
  const inboxStdio = await betaStdio.call("handoff_inbox", {});
  assert.equal((inboxStdio.value?.handoffs as unknown[]).length, 1);
  await betaStdio.close();
});

void test("HTTP enforces the configured rate limit and readiness reflects degraded policy", async (t) => {
  const fixture = await createFixture(baseAgents());
  const harness = await startHttpHarness(fixture, { HANDOFF_MCP_RATE_LIMIT: "3", HANDOFF_MCP_RATE_WINDOW_MS: "60000" });
  t.after(async () => {
    await harness.close();
    await fixture.dispose();
  });

  const token = fixture.tokens.get("alpha")!.token;

  // Origin allowlist: a disallowed Origin is rejected before reaching a tool.
  const strictOrigin = await startHttpHarness(fixture, { HANDOFF_MCP_ALLOWED_ORIGINS: "http://allowed.example" });
  const badOrigin = await fetch(strictOrigin.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Origin: "http://evil.example",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  assert.ok(badOrigin.status >= 400, `disallowed Origin must be rejected, got ${badOrigin.status}`);
  await badOrigin.arrayBuffer();
  await strictOrigin.close();

  const statuses: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const response = await fetch(harness.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: i, method: "ping" }),
    });
    statuses.push(response.status);
    await response.arrayBuffer();
  }
  assert.ok(statuses.includes(429), `rate limit must trigger, got ${statuses.join(", ")}`);

  // Health stays reachable and reports policy state; readiness degrades when
  // the registry is broken and recovers when it is restored.
  const base = harness.url.replace("/mcp", "");
  const health = await (await fetch(`${base}/healthz`)).json() as { policy?: { status?: string } };
  assert.equal(health.policy?.status, "ok");

  const { writeFile: wf, utimes: ut } = await import("node:fs/promises");
  await wf(fixture.registryFile, "version: 1\nagents: [", "utf8");
  const when = new Date(Date.now() + 5_000);
  await ut(fixture.registryFile, when, when);
  const notReady = await fetch(`${base}/readyz`);
  assert.equal(notReady.status, 503, "readiness must fail while policy is degraded");
  await notReady.arrayBuffer();

  await fixture.writeRegistry(baseAgents());
  const ready = await fetch(`${base}/readyz`);
  assert.equal(ready.status, 200);
  await ready.arrayBuffer();
});
