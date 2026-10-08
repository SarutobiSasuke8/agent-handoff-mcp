#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = await mkdtemp(path.join(os.tmpdir(), "agent-handoff-eval-"));
const registryFile = path.join(dir, "agents.yaml");
const databaseFile = path.join(dir, "handoffs.sqlite");
const alphaToken = `handoff_${randomBytes(32).toString("base64url")}`;
const betaToken = `handoff_${randomBytes(32).toString("base64url")}`;
const alphaDigest = createHash("sha256").update(alphaToken, "utf8").digest("hex");
const betaDigest = createHash("sha256").update(betaToken, "utf8").digest("hex");
const registry = `version: 1
agents:
  - id: eval-alpha
    display_name: Evaluation Alpha
    enabled: true
    send_to: [eval-beta]
    receive_from: [eval-beta]
    disclosure_ceiling: internal
    token_sha256: ${alphaDigest}
    expires_at: 2100-01-01T00:00:00Z
  - id: eval-beta
    display_name: Evaluation Beta
    enabled: true
    send_to: [eval-alpha]
    receive_from: [eval-alpha]
    disclosure_ceiling: internal
    token_sha256: ${betaDigest}
    expires_at: 2100-01-01T00:00:00Z
`;
await writeFile(registryFile, registry, { mode: 0o600 });

const { loadConfig } = await import(path.join(root, "dist/src/config.js"));
const { createRuntime } = await import(path.join(root, "dist/src/runtime.js"));
const config = loadConfig({ HANDOFF_AGENT_ID: "eval-alpha", HANDOFF_MCP_DB: databaseFile, HANDOFF_MCP_REGISTRY: registryFile });
const runtime = createRuntime(config);
await runtime.registry.current();
const seeded = await runtime.service.send("eval-alpha", {
  recipient: "eval-beta",
  title: "Seeded transition",
  summary: "A queued handoff for the illegal transition contract.",
  request: "Do not complete this queued handoff.",
  contextRefs: [],
  artifactRefs: [],
  tags: [],
  sensitivity: "internal",
  priority: "normal",
});
const placeholder = "00000000-0000-0000-0000-000000000000";
runtime.store.close();

const child = spawn(process.execPath, [path.join(root, "dist/src/stdio.js")], {
  env: { ...process.env, HANDOFF_AGENT_ID: "eval-alpha", HANDOFF_MCP_DB: databaseFile, HANDOFF_MCP_REGISTRY: registryFile },
  stdio: ["pipe", "pipe", "inherit"],
});
process.stdin.setEncoding("utf8");
let pending = "";
process.stdin.on("data", (chunk) => {
  pending += chunk;
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) child.stdin.write(line.replaceAll(placeholder, seeded.id) + "\n");
});
process.stdin.on("end", () => {
  if (pending) child.stdin.write(pending.replaceAll(placeholder, seeded.id));
  child.stdin.end();
});
child.stdout.pipe(process.stdout);
const exitCode = await new Promise((resolve) => child.on("close", (code, signal) => resolve(code ?? (signal ? 1 : 0))));
await rm(dir, { recursive: true, force: true });
process.exit(exitCode);
