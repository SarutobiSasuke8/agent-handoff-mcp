import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../src/auth.js";
import { disableAgent, enableAgent, initRegistry, issueToken, newToken, revokeToken } from "../src/provision.js";
import { parseRegistry } from "../src/registry.js";
import { runValidate } from "../src/validate.js";

async function tempDir(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const temp = await mkdtemp(path.join(os.tmpdir(), "handoff-provision-"));
  t.after(async () => rm(temp, { recursive: true, force: true }));
  return temp;
}

void test("token generation binds raw token to registry digest", () => {
  const issued = newToken();
  assert.match(issued.token, /^handoff_[A-Za-z0-9_-]{43}$/u);
  assert.equal(issued.digest, sha256(issued.token));
});

void test("init creates a valid registry with no enabled identities and refuses overwrite", async (t) => {
  const temp = await tempDir(t);
  const file = path.join(temp, "agents.yaml");
  await initRegistry(file);
  const agents = parseRegistry(await readFile(file, "utf8"));
  assert.equal(agents.length, 2);
  assert.ok(agents.every((agent) => !agent.enabled), "synthetic identities must start disabled");
  assert.ok(agents.every((agent) => !agent.tokenSha256), "no token bindings before issue");
  await assert.rejects(initRegistry(file), /EEXIST/u);
});

void test("issue, rotate, disable, enable, and revoke drive the full credential lifecycle", async (t) => {
  const temp = await tempDir(t);
  const file = path.join(temp, "agents.yaml");
  await initRegistry(file);

  await assert.rejects(issueToken(file, "example-alpha", "not-a-date"), /ISO 8601/u);
  await assert.rejects(issueToken(file, "example-alpha", "2020-01-01T00:00:00Z"), /future/u);
  await assert.rejects(issueToken(file, "missing-agent", "2100-01-01T00:00:00Z"), /not defined/u);
  await assert.rejects(
    issueToken(file, "example-alpha", "2100-01-01T00:00:00Z", { requireExistingToken: true }),
    /no token to rotate/u,
  );

  const issued = await issueToken(file, "example-alpha", "2100-01-01T00:00:00Z");
  let source = await readFile(file, "utf8");
  assert.ok(!source.includes(issued.token), "raw token must never be written to disk");
  assert.ok(source.includes(issued.digest), "registry stores only the digest");

  const rotated = await issueToken(file, "example-alpha", "2100-01-01T00:00:00Z", { requireExistingToken: true });
  source = await readFile(file, "utf8");
  assert.ok(!source.includes(issued.digest), "rotation must replace the previous digest");
  assert.ok(source.includes(rotated.digest));

  await enableAgent(file, "example-alpha");
  assert.equal(parseRegistry(await readFile(file, "utf8")).find((a) => a.id === "example-alpha")?.enabled, true);
  await disableAgent(file, "example-alpha");
  assert.equal(parseRegistry(await readFile(file, "utf8")).find((a) => a.id === "example-alpha")?.enabled, false);

  await revokeToken(file, "example-alpha");
  source = await readFile(file, "utf8");
  assert.ok(!source.includes(rotated.digest), "revocation removes the token binding");
  parseRegistry(source);
});

void test("validate reports success and failure without echoing token material", async (t) => {
  const temp = await tempDir(t);
  const file = path.join(temp, "agents.yaml");
  await initRegistry(file);
  assert.equal(await runValidate(file), 0);
  assert.equal(await runValidate(path.join(temp, "missing.yaml")), 1);

  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, "version: 7\nagents: []\n", "utf8");
  assert.equal(await runValidate(file), 1);
});
