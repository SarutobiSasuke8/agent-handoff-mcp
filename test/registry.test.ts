import assert from "node:assert/strict";
import test from "node:test";

import { parseRegistry, permitsSensitivity } from "../src/registry.js";

const validRegistry = `
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
    disclosure_ceiling: restricted
`;

void test("registry parsing maps explicit communication boundaries", () => {
  const agents = parseRegistry(validRegistry);
  assert.equal(agents.length, 2);
  assert.deepEqual(agents[0]?.sendTo, ["codex"]);
  assert.equal(permitsSensitivity(agents[0]!, "internal"), true);
  assert.equal(permitsSensitivity(agents[0]!, "restricted"), false);
});

void test("registry rejects references to unknown agents", () => {
  assert.throws(
    () => parseRegistry(validRegistry.replace("send_to: [codex]", "send_to: [ghost]")),
    /unknown agent 'ghost'/u,
  );
});

void test("registry rejects duplicate token hashes", () => {
  const withTokens = validRegistry
    .replace("disclosure_ceiling: internal", `disclosure_ceiling: internal\n    token_sha256: ${"a".repeat(64)}`)
    .replace("disclosure_ceiling: restricted", `disclosure_ceiling: restricted\n    token_sha256: ${"a".repeat(64)}`);
  assert.throws(() => parseRegistry(withTokens), /Duplicate token hash/u);
});
