import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentRegistry } from "../src/registry.js";
import { HandoffService } from "../src/service.js";
import { HandoffStore } from "../src/store.js";

import type { CreateHandoffInput } from "../src/types.js";

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

interface Fixture {
  service: HandoffService;
  store: HandoffStore;
  registryFile: string;
  setRegistry: (yaml: string) => Promise<void>;
  dispose: () => Promise<void>;
}

let clock = 0;

async function fixture(): Promise<Fixture> {
  const temp = await mkdtemp(path.join(os.tmpdir(), "handoff-mcp-"));
  const registryFile = path.join(temp, "agents.yaml");
  const store = new HandoffStore(":memory:");
  const service = new HandoffService(new AgentRegistry(registryFile), store, {
    maxMessageBytes: 32_768,
    maxHandoffDepth: 8,
  });
  const setRegistry = async (yaml: string): Promise<void> => {
    await writeFile(registryFile, yaml, "utf8");
    // Distinct mtimes so every rewrite is observed as a policy change.
    clock += 1;
    const when = new Date(Date.now() - 60_000 + clock * 1000);
    await utimes(registryFile, when, when);
  };
  await setRegistry(registryYaml);
  return {
    service,
    store,
    registryFile,
    setRegistry,
    dispose: async () => {
      store.close();
      await rm(temp, { recursive: true, force: true });
    },
  };
}

function baseInput(overrides: Partial<CreateHandoffInput> = {}): CreateHandoffInput {
  return {
    recipient: "codex",
    title: "Review",
    summary: "Review this.",
    request: "Return a decision.",
    contextRefs: [],
    artifactRefs: [],
    tags: [],
    sensitivity: "internal",
    priority: "normal",
    ...overrides,
  };
}

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

void test("service prevents unauthorized recipients and non-participant reads", async (t) => {
  const f = await fixture();
  t.after(f.dispose);

  const handoff = await f.service.send("claude", baseInput());
  assert.equal((await f.service.get("codex", handoff.id)).handoff.id, handoff.id);
  await assert.rejects(f.service.get("observer", handoff.id), /not found or is not accessible/u);
  await assert.rejects(f.service.send("claude", baseInput({ recipient: "observer" })), /may not send/u);
});

void test("revocation: a disabled principal loses every operation mid-session", async (t) => {
  const f = await fixture();
  t.after(f.dispose);

  const handoff = await f.service.send("claude", baseInput());
  assert.equal((await f.service.inbox("codex", ["queued"], 20)).length, 1);

  // Audit probe AHMCP-02: after disabling the recipient, it could previously
  // still list its inbox and acknowledge the handoff.
  await f.setRegistry(registryYaml.replace(
    "enabled: true\n    send_to: [claude]",
    "enabled: false\n    send_to: [claude]",
  ));
  await assert.rejects(f.service.whoami("codex"), /not authorised/u);
  await assert.rejects(f.service.inbox("codex", ["queued"], 20), /not authorised/u);
  await assert.rejects(f.service.get("codex", handoff.id), /not authorised/u);
  await assert.rejects(f.service.acknowledge("codex", handoff.id), /not authorised/u);
  await assert.rejects(f.service.updateStatus("codex", handoff.id, "completed"), /not authorised/u);

  // Re-enabling restores access without a restart.
  await f.setRegistry(registryYaml);
  assert.equal((await f.service.acknowledge("codex", handoff.id)).status, "accepted");
});

void test("revocation: an expired principal is rejected on every operation", async (t) => {
  const f = await fixture();
  t.after(f.dispose);

  const handoff = await f.service.send("claude", baseInput());
  await f.setRegistry(registryYaml.replace(
    "disclosure_ceiling: internal\n  - id: observer",
    "disclosure_ceiling: internal\n    expires_at: 2020-01-01T00:00:00Z\n  - id: observer",
  ));
  await assert.rejects(f.service.whoami("codex"), /not authorised/u);
  await assert.rejects(f.service.acknowledge("codex", handoff.id), /not authorised/u);
});

void test("historical reads default to deny after relationship removal", async (t) => {
  const f = await fixture();
  t.after(f.dispose);

  const handoff = await f.service.send("claude", baseInput());
  await f.setRegistry(registryYaml
    .replace("send_to: [codex]", "send_to: []")
    .replace("receive_from: [claude]", "receive_from: []"));

  let deniedMessage = "";
  await assert.rejects(f.service.get("codex", handoff.id), (error: Error) => {
    deniedMessage = error.message.replace(handoff.id, "<id>");
    return /not found or is not accessible/u.test(error.message);
  });
  assert.equal((await f.service.inbox("codex", ["queued"], 20)).length, 0);
  await assert.rejects(f.service.acknowledge("codex", handoff.id), /not found or is not accessible/u);

  // No existence oracle: a missing handoff and a forbidden handoff produce the
  // same error shape.
  await assert.rejects(f.service.get("codex", MISSING_ID), (error: Error) => {
    assert.equal(error.message.replace(MISSING_ID, "<id>"), deniedMessage);
    return true;
  });
});

void test("historical reads default to deny after ceiling reduction", async (t) => {
  const f = await fixture();
  t.after(f.dispose);

  const handoff = await f.service.send("claude", baseInput({ sensitivity: "internal" }));
  await f.setRegistry(registryYaml.replace(
    "disclosure_ceiling: internal\n  - id: observer",
    "disclosure_ceiling: public-safe\n  - id: observer",
  ));
  await assert.rejects(f.service.get("codex", handoff.id), /not found or is not accessible/u);
  assert.equal((await f.service.inbox("codex", ["queued"], 20)).length, 0);
  await assert.rejects(f.service.acknowledge("codex", handoff.id), /not found or is not accessible/u);
});

void test("a failed registry reload keeps the prior policy active for operations", async (t) => {
  const f = await fixture();
  t.after(f.dispose);

  const handoff = await f.service.send("claude", baseInput());
  await f.setRegistry("version: 1\nagents: [");
  // Prior valid policy stays in force: the recipient still operates.
  assert.equal((await f.service.acknowledge("codex", handoff.id)).status, "accepted");
});
