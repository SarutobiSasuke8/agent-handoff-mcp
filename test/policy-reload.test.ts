import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentRegistry } from "../src/registry.js";

const registryA = `
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
`;

const registryB = registryA.replace("enabled: true\n    send_to: [claude]", "enabled: false\n    send_to: [claude]");

async function touch(file: string, secondsFromNow: number): Promise<void> {
  const when = new Date(Date.now() + secondsFromNow * 1000);
  await utimes(file, when, when);
}

void test("registry provider reloads on change and survives a failed reload as degraded", async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "handoff-policy-"));
  t.after(async () => rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, "agents.yaml");

  await writeFile(file, registryA, "utf8");
  await touch(file, -30);
  const registry = new AgentRegistry(file);

  const first = await registry.current();
  assert.equal(first.resolveActive("codex").id, "codex");
  assert.equal(registry.state().status, "ok");
  assert.equal(registry.state().revision, first.revision);

  // Unchanged file: the same immutable snapshot is reused.
  assert.equal(await registry.current(), first);

  // A registry change is observed without restart.
  await writeFile(file, registryB, "utf8");
  await touch(file, -20);
  const second = await registry.current();
  assert.notEqual(second.revision, first.revision);
  assert.throws(() => second.resolveActive("codex"), /not authorised/u);

  // A partial or invalid write keeps the prior valid policy active and marks
  // the provider degraded instead of failing open or crashing.
  await writeFile(file, registryB.slice(0, registryB.length / 2), "utf8");
  await touch(file, -10);
  const degraded = await registry.current();
  assert.equal(degraded.revision, second.revision);
  const state = registry.state();
  assert.equal(state.status, "degraded");
  assert.ok(state.reason && state.reason.length > 0);

  // Restoring a valid file clears the degraded state.
  await writeFile(file, registryA, "utf8");
  await touch(file, 0);
  const recovered = await registry.current();
  assert.equal(recovered.revision, first.revision);
  assert.equal(registry.state().status, "ok");
});

void test("registry provider with no valid snapshot fails closed", async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "handoff-policy-"));
  t.after(async () => rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, "agents.yaml");
  await writeFile(file, "version: 99\nagents: []\n", "utf8");
  const registry = new AgentRegistry(file);
  await assert.rejects(registry.current(), /unsupported registry schema version/u);
  assert.equal(registry.state().status, "degraded");
});
