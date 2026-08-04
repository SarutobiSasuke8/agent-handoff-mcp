import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentRegistry } from "../src/registry.js";
import { HandoffService } from "../src/service.js";
import { HandoffStore } from "../src/store.js";

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

void test("service prevents unauthorized recipients and non-participant reads", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "handoff-mcp-"));
  const registryFile = path.join(temp, "agents.yaml");
  await writeFile(registryFile, registryYaml, "utf8");
  const store = new HandoffStore(":memory:");
  const service = new HandoffService(new AgentRegistry(registryFile), store, {
    maxMessageBytes: 32_768,
    maxHandoffDepth: 8,
  });

  try {
    const handoff = await service.send("claude", {
      recipient: "codex",
      title: "Review",
      summary: "Review this.",
      request: "Return a decision.",
      contextRefs: [],
      artifactRefs: [],
      tags: [],
      sensitivity: "internal",
      priority: "normal",
    });
    assert.equal(service.get("codex", handoff.id).handoff.id, handoff.id);
    assert.throws(() => service.get("observer", handoff.id), /not a participant/u);
    await assert.rejects(
      service.send("claude", {
        recipient: "observer",
        title: "No",
        summary: "Not permitted.",
        request: "Should fail.",
        contextRefs: [],
        artifactRefs: [],
        tags: [],
        sensitivity: "internal",
        priority: "normal",
      }),
      /may not send/u,
    );
  } finally {
    store.close();
    await rm(temp, { recursive: true, force: true });
  }
});
