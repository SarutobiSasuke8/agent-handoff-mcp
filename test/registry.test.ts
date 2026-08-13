import assert from "node:assert/strict";
import test from "node:test";

import { RegistryValidationError, parseRegistry, permitsSensitivity, registryJsonSchema, snapshotFromSource } from "../src/registry.js";

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

function issuesOf(source: string): string[] {
  try {
    parseRegistry(source);
  } catch (error) {
    if (error instanceof RegistryValidationError) return error.issues;
    throw error;
  }
  throw new Error("Expected the registry to be rejected.");
}

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

void test("registry rejects duplicate token hashes without echoing them", () => {
  const withTokens = validRegistry
    .replace("disclosure_ceiling: internal", `disclosure_ceiling: internal\n    token_sha256: ${"a".repeat(64)}`)
    .replace("disclosure_ceiling: restricted", `disclosure_ceiling: restricted\n    token_sha256: ${"a".repeat(64)}`);
  assert.throws(() => parseRegistry(withTokens), (error: unknown) => {
    assert.ok(error instanceof RegistryValidationError);
    assert.match(error.message, /duplicate token hash/u);
    assert.ok(!error.message.includes("a".repeat(64)), "error must not echo token material");
    return true;
  });
});

// Audit probe AHMCP-01: 'enable' instead of 'enabled' previously parsed
// successfully and produced an enabled principal.
void test("registry rejects the audit probe typo 'enable'", () => {
  const probe = validRegistry.replace("enabled: true\n    send_to: [codex]", "enable: false\n    send_to: [codex]");
  const issues = issuesOf(probe);
  assert.ok(issues.some((issue) => issue.includes("'enable'")), `unknown-key issue expected, got: ${issues.join("; ")}`);
});

// Audit probe AHMCP-01: misspelled disclosure field previously fell back to a
// permissive default ceiling.
void test("registry rejects a misspelled disclosure field instead of defaulting", () => {
  const probe = validRegistry.replace("disclosure_ceiling: internal", "disclosure_ceilling: internal");
  const issues = issuesOf(probe);
  assert.ok(issues.some((issue) => issue.includes("'disclosure_ceilling'")));
  assert.ok(issues.some((issue) => issue.includes("disclosure_ceiling")), "missing required field must be reported");
});

// Audit probe AHMCP-01: unknown authorisation-shaped keys such as 'denny' must
// be rejected, not silently ignored.
void test("registry rejects unknown authorisation keys", () => {
  const probe = validRegistry.replace("receive_from: [codex]", "receive_from: [codex]\n    denny: [codex]");
  const issues = issuesOf(probe);
  assert.ok(issues.some((issue) => issue.includes("'denny'")));
});

void test("registry requires explicit enabled, relationships, and ceiling", () => {
  const missingEnabled = validRegistry.replace("    enabled: true\n    send_to: [codex]", "    send_to: [codex]");
  assert.ok(issuesOf(missingEnabled).some((issue) => issue.includes("enabled")));
  const missingRelations = validRegistry.replace("    send_to: [claude]\n    receive_from: [claude]\n", "");
  const issues = issuesOf(missingRelations);
  assert.ok(issues.some((issue) => issue.includes("send_to")));
  assert.ok(issues.some((issue) => issue.includes("receive_from")));
});

void test("registry rejects unsupported schema versions", () => {
  assert.throws(
    () => parseRegistry(validRegistry.replace("version: 1", "version: 2")),
    /unsupported registry schema version/u,
  );
});

void test("registry rejects malformed expiry data with a field-specific error", () => {
  const probe = validRegistry.replace(
    "disclosure_ceiling: restricted",
    "disclosure_ceiling: restricted\n    expires_at: not-a-date",
  );
  const issues = issuesOf(probe);
  assert.ok(issues.some((issue) => issue.includes("expires_at")));
});

void test("registry rejects duplicate agent ids", () => {
  const probe = validRegistry.replace("id: codex", "id: claude");
  assert.ok(issuesOf(probe).some((issue) => issue.includes("duplicate agent id 'claude'")));
});

void test("registry rejects duplicate relationship entries", () => {
  const probe = validRegistry.replace("send_to: [codex]", "send_to: [codex, codex]");
  assert.ok(issuesOf(probe).some((issue) => issue.includes("duplicate entry 'codex'")));
});

void test("registry rejects a wildcard mixed with explicit entries", () => {
  const probe = validRegistry.replace("send_to: [codex]", "send_to: ['*', codex]");
  assert.ok(issuesOf(probe).some((issue) => issue.includes("'*' must be the only entry")));
});

void test("registry rejects partial writes and empty documents", () => {
  const truncated = validRegistry.slice(0, validRegistry.indexOf("receive_from: [claude]"));
  assert.throws(() => parseRegistry(truncated), RegistryValidationError);
  assert.throws(() => parseRegistry(""), RegistryValidationError);
  assert.throws(() => parseRegistry("version: 1\nagents: []\n"), RegistryValidationError);
});

void test("registry errors never echo token-like values", () => {
  const secret = `handoff_${"s".repeat(43)}`;
  const probe = validRegistry.replace(
    "disclosure_ceiling: internal",
    `disclosure_ceiling: internal\n    token_sha256: ${secret}`,
  );
  try {
    parseRegistry(probe);
    assert.fail("expected rejection");
  } catch (error) {
    assert.ok(error instanceof RegistryValidationError);
    assert.ok(!error.message.includes(secret), "error must not echo the invalid token value");
    assert.ok(error.issues.some((issue) => issue.includes("token_sha256")));
  }
});

void test("snapshots expose a stable content revision", () => {
  const first = snapshotFromSource(validRegistry);
  const second = snapshotFromSource(validRegistry);
  assert.equal(first.revision, second.revision);
  assert.notEqual(first.revision, snapshotFromSource(validRegistry.replace("Claude", "Claude Prime")).revision);
  assert.equal(first.all().length, 2);
});

void test("snapshot resolveActive rejects disabled and expired principals", () => {
  const disabled = snapshotFromSource(validRegistry.replace("enabled: true\n    send_to: [codex]", "enabled: false\n    send_to: [codex]"));
  assert.throws(() => disabled.resolveActive("claude"), /not authorised/u);
  const expired = snapshotFromSource(validRegistry.replace(
    "disclosure_ceiling: internal",
    "disclosure_ceiling: internal\n    expires_at: 2020-01-01T00:00:00Z",
  ));
  assert.throws(() => expired.resolveActive("claude"), /not authorised/u);
  assert.equal(expired.resolveActive("codex").id, "codex");
});

void test("published JSON Schema matches the runtime schema", async () => {
  const { readFile } = await import("node:fs/promises");
  const filed = JSON.parse(await readFile(new URL("../../schema/agent-registry.schema.v1.json", import.meta.url), "utf8")) as unknown;
  assert.deepEqual(filed, registryJsonSchema());
});
