import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { newToken } from "../../src/provision.js";
import { createFixture, startHttpHarness, startStdioSession } from "./harness.js";

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/cli.js");
const agents = [
  { id: "alpha", sendTo: ["beta"], receiveFrom: ["beta"] },
  { id: "beta", sendTo: ["alpha"], receiveFrom: ["alpha"] },
  { id: "gamma", sendTo: [], receiveFrom: [] },
];
const payload = { recipient: "beta", title: "Recovery proof", summary: "Synthetic recovery fixture.",
  request: "Verify restored state.", idempotency_key: "recover-1" };

function cli(args: string[]): string {
  return execFileSync(process.execPath, [cliPath, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function refused(args: string[], expected: RegExp): void {
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, expected);
}

void test("live WAL backup restores handoffs, events, idempotency and rotated/revoked credentials through MCP", async (t) => {
  const fixture = await createFixture(agents);
  t.after(async () => fixture.dispose());
  let harness = await startHttpHarness(fixture);
  t.after(async () => harness.close());
  const alpha = await harness.connect(fixture.tokens.get("alpha")!.token);
  const beta = await harness.connect(fixture.tokens.get("beta")!.token);
  const sent = await alpha.call("handoff_send", payload);
  assert.ok(sent.ok, sent.text);
  const id = (sent.value?.handoff as { id: string }).id;
  assert.ok((await beta.call("handoff_acknowledge", { handoff_id: id, note: "Accepted before backup." })).ok);
  const original = await beta.call("handoff_get", { handoff_id: id });
  await alpha.close();
  await beta.close();
  const oldToken = fixture.tokens.get("beta")!.token;
  const revokedToken = fixture.tokens.get("gamma")!.token;
  fixture.tokens.set("beta", newToken());
  fixture.tokens.delete("gamma");
  await fixture.writeRegistry(agents.map((agent) => agent.id === "gamma" ? { ...agent, enabled: false } : agent));

  const backupFile = path.join(fixture.dir, "live.backup");
  assert.ok(existsSync(`${fixture.databaseFile}-wal`), "snapshot must exercise the live WAL");
  const backupOutput = cli(["backup", backupFile, "--db", fixture.databaseFile, "--registry", fixture.registryFile]);
  assert.match(backupOutput, /Backup validated/u);
  assert.ok(!backupOutput.includes(oldToken));
  assert.ok(!readFileSync(backupFile).includes(Buffer.from(oldToken)), "backup contains digests, never raw tokens");
  // --force cannot override a running HTTP server or a shared registry lease.
  refused(["restore", backupFile, "--db", fixture.databaseFile, "--registry", fixture.registryFile, "--force"], /server is still running/u);
  refused(["restore", backupFile, "--db", path.join(fixture.dir, "other.sqlite"), "--registry", fixture.registryFile, "--force"], /server is still running/u);
  await harness.close();

  const restored = { ...fixture, databaseFile: path.join(fixture.dir, "restored", "handoffs.sqlite"),
    registryFile: path.join(fixture.dir, "restored", "agents.yaml") };
  assert.match(cli(["restore", backupFile, "--db", restored.databaseFile, "--registry", restored.registryFile]), /restored/u);
  assert.equal(readFileSync(restored.registryFile, "utf8"), readFileSync(fixture.registryFile, "utf8"));
  harness = await startHttpHarness(restored);
  const restoredAlpha = await harness.connect(fixture.tokens.get("alpha")!.token);
  const restoredBeta = await harness.connect(fixture.tokens.get("beta")!.token);
  const get = await restoredBeta.call("handoff_get", { handoff_id: id });
  assert.deepEqual(get.value, original.value, "handoff and complete event history survive recovery");
  const retry = await restoredAlpha.call("handoff_send", payload);
  assert.equal((retry.value?.handoff as { id: string }).id, id);
  const conflict = await restoredAlpha.call("handoff_send", { ...payload, title: "Different content" });
  assert.ok(!conflict.ok);
  assert.match(conflict.text, /Idempotency/u);
  const inbox = await restoredBeta.call("handoff_inbox", {});
  assert.equal((inbox.value?.handoffs as unknown[]).length, 1);
  await assert.rejects(harness.connect(oldToken), "rotated token stays rejected after recovery");
  await assert.rejects(harness.connect(revokedToken), "revoked token stays rejected after recovery");
  await assert.rejects(startStdioSession(restored, "gamma"), "revoked identity stays rejected on stdio");
  await restoredAlpha.close();
  await restoredBeta.close();
  await harness.close();

  const stdio = await startStdioSession(restored, "beta");
  refused(["restore", backupFile, "--db", restored.databaseFile, "--registry", restored.registryFile, "--force"], /server is still running/u);
  assert.ok((await stdio.call("handoff_get", { handoff_id: id })).ok);
  await stdio.close();
});

void test("corrupt/truncated backup and unsafe destinations fail without replacing state", async (t) => {
  const fixture = await createFixture(agents);
  t.after(async () => fixture.dispose());
  const harness = await startHttpHarness(fixture);
  const backupFile = path.join(fixture.dir, "good.backup");
  cli(["backup", backupFile, "--db", fixture.databaseFile, "--registry", fixture.registryFile]);
  refused(["backup", backupFile, "--db", fixture.databaseFile, "--registry", fixture.registryFile], /new file/u);
  await harness.close();
  const beforeDb = readFileSync(fixture.databaseFile);
  const beforePolicy = readFileSync(fixture.registryFile);
  for (const [name, bytes] of [["corrupt", Buffer.from("not a database")], ["truncated", readFileSync(backupFile).subarray(0, 120)]] as const) {
    const bad = path.join(fixture.dir, name);
    writeFileSync(bad, bytes);
    refused(["restore", bad, "--db", fixture.databaseFile, "--registry", fixture.registryFile, "--force"], /Invalid or corrupt/u);
    assert.deepEqual(readFileSync(fixture.databaseFile), beforeDb);
    assert.deepEqual(readFileSync(fixture.registryFile), beforePolicy);
  }
  refused(["restore", backupFile, "--db", fixture.databaseFile, "--registry", fixture.registryFile], /requires --force/u);
  for (const kind of ["metadata", "trigger"] as const) {
    const tampered = path.join(fixture.dir, `${kind}.backup`);
    copyFileSync(backupFile, tampered);
    const db = new DatabaseSync(tampered);
    if (kind === "metadata") db.exec("UPDATE handoff_recovery_metadata SET registry = 'invalid secret-shaped input'");
    else db.exec("CREATE TRIGGER unexpected AFTER INSERT ON handoffs BEGIN DELETE FROM handoff_events; END");
    db.close();
    refused(["restore", tampered, "--db", fixture.databaseFile, "--registry", fixture.registryFile, "--force"], /Invalid or corrupt/u);
    assert.deepEqual(readFileSync(fixture.databaseFile), beforeDb);
    assert.deepEqual(readFileSync(fixture.registryFile), beforePolicy);
  }
  writeFileSync(`${fixture.databaseFile}-wal`, "legacy WAL");
  refused(["restore", backupFile, "--db", fixture.databaseFile, "--registry", fixture.registryFile, "--force"], /WAL sidecars/u);
});

void test("stopped --force replacement preserves previous files and interrupted recovery blocks startup", async (t) => {
  const fixture = await createFixture(agents);
  t.after(async () => fixture.dispose());
  const harness = await startHttpHarness(fixture);
  const file = path.join(fixture.dir, "snapshot.backup");
  cli(["backup", file, "--db", fixture.databaseFile, "--registry", fixture.registryFile]);
  await harness.close();
  const previousDb = readFileSync(fixture.databaseFile);
  const previousPolicy = readFileSync(fixture.registryFile);
  assert.match(cli(["restore", file, "--db", fixture.databaseFile, "--registry", fixture.registryFile, "--force"]), /restored/u);
  const preserved = readdirSync(fixture.dir).filter((name) => name.endsWith(".pre-restore"));
  assert.equal(preserved.length, 2);
  for (const name of preserved) assert.deepEqual(readFileSync(path.join(fixture.dir, name)), name.startsWith("handoffs.sqlite") ? previousDb : previousPolicy);
  const recovered = await startHttpHarness(fixture);
  await recovered.close();
  writeFileSync(`${fixture.databaseFile}.handoff-restore-pending`, "interrupted install");
  await assert.rejects(startHttpHarness(fixture), /interrupted restore/u);
  refused(["restore", file, "--db", fixture.databaseFile, "--registry", fixture.registryFile, "--force"], /interrupted restore/u);
});
