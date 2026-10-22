import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createFixture, startHttpHarness, TOOL_NAMES } from "../dist/test/e2e/harness.js";

// This is a test runner, never a protocol migration or a publication command.
const SPEC_REVISION = "2026-07-28";
const SERVER_TARGET = "2025-11-25";
const CONFORMANCE = "@modelcontextprotocol/conformance@0.2.0-alpha.12";
const INSPECTOR = "@modelcontextprotocol/inspector@2.11.0";
const root = fileURLToPath(new globalThis.URL("../", import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run with npm run conformance");
const npxCli = path.join(path.dirname(npmCli), "npx-cli.js");
const evidence = path.resolve(process.env.HANDOFF_CONFORMANCE_OUTPUT ?? "release-evidence/conformance");
await mkdir(evidence, { recursive: true });
const results = [];
let token = "";
const redact = (text) => token ? text.replaceAll(token, "[fixture-token-redacted]") : text;

async function step(name, action) {
  try {
    const detail = await action();
    results.push({ name, ok: true, detail });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    results.push({ name, ok: false, detail: redact(String(error)) });
    process.stdout.write(`FAIL ${name}: ${redact(String(error))}\n`);
  }
}

async function command(args, env = process.env, timeout = 300_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, timeout, windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, output: redact(output) }));
  });
}

async function checkedCommand(name, args, env) {
  const result = await command(args, env);
  await writeFile(path.join(evidence, `${name}.txt`), result.output);
  assert.equal(result.code, 0, `${name} exited ${result.code} (${result.signal ?? "no signal"}); see ${name}.txt`);
  return result.output;
}

process.stdout.write(`Asserted HTTP revision: ${SPEC_REVISION}; current HTTP transport target: ${SERVER_TARGET}.\n`);
await step("registry-schema-and-pack", () => checkedCommand("registry", [npmCli, "run", "check:registry"]));
const fixture = await createFixture([{ id: "conformance-fixture" }]);
let http;
try {
  token = fixture.tokens.get("conformance-fixture").token;
  assert.ok(token, "Fixture credential unavailable");
  http = await startHttpHarness(fixture, { HANDOFF_MCP_RATE_LIMIT: "10000" });
  const curl = process.platform === "win32" ? "curl.exe" : "curl";
  for (const invalid of [false, true]) {
    await step(`auth-${invalid ? "invalid" : "missing"}`, async () => {
      const args = ["--silent", "--show-error", "--max-time", "10", "--output", process.platform === "win32" ? "NUL" : "/dev/null", "--write-out", "%{http_code}", "--request", "POST", http.url,
        "--header", "Content-Type: application/json", "--data", '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'];
      if (invalid) args.push("--header", "Authorization: Bearer intentionally-invalid-test-value");
      const code = await new Promise((resolve, reject) => {
        const child = spawn(curl, args, { windowsHide: true });
        let output = "";
        child.stdout.on("data", (chunk) => { output += chunk; });
        child.stderr.resume();
        child.on("error", reject);
        child.on("close", (exit) => exit === 0 ? resolve(output.trim()) : reject(new Error(`curl exited ${exit}`)));
      });
      assert.ok(["401", "403"].includes(code), `Unexpected HTTP ${code}`);
      return { status: code };
    });
  }
  await step("conformance-requirements", async () => {
    const env = { ...process.env,
      NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, "tools/conformance-auth.mjs")).href}`,
      HANDOFF_CONFORMANCE_URL: http.url, HANDOFF_CONFORMANCE_TOKEN: token };
    try {
      await checkedCommand("framework", [npxCli, "--yes", CONFORMANCE, "server", "--url", http.url,
        "--requirements", SPEC_REVISION, "--timeout", "5000", "--output-dir", path.join(fixture.dir, "framework-results")], env);
      return { revision: SPEC_REVISION };
    } finally {
      const folder = path.join(fixture.dir, "framework-results");
      const checks = [];
      for (const filename of await readdir(folder, { recursive: true }).catch(() => [])) {
        if (!filename.endsWith("checks.json")) continue;
        checks.push({ scenario: path.dirname(filename), checks: JSON.parse(redact(await readFile(path.join(folder, filename), "utf8"))) });
      }
      await writeFile(path.join(evidence, "framework-checks.json"), JSON.stringify(checks, null, 2) + "\n");
      assert.ok(checks.length, "Framework produced no scenario checks");
    }
  });
  const inspectorArgs = [npxCli, "--yes", INSPECTOR, "--cli", http.url, "--transport", "http", "--protocol-era", "legacy",
    "--format", "json", "--stored-auth-only",
    "--client-config", path.join(fixture.dir, "client.json"), "--header", `Authorization: Bearer ${token}`];
  await step("inspector-tools-list", async () => {
    const output = await checkedCommand("inspector-list", [...inspectorArgs, "--method", "tools/list"]);
    const data = JSON.parse(output);
    const tools = data.tools ?? data.result?.tools;
    assert.ok(Array.isArray(tools), "Inspector must return a tools array");
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
    return { tools: TOOL_NAMES.length };
  });
  await step("inspector-tools-call", async () => {
    const output = await checkedCommand("inspector-call", [...inspectorArgs, "--method", "tools/call", "--tool-name", "handoff_whoami"]);
    const data = JSON.parse(output);
    assert.notEqual((data.result ?? data).isError, true);
    assert.ok(output.includes("conformance-fixture"), "Whoami must return the fixture identity");
    return { tool: "handoff_whoami" };
  });
} finally {
  if (http) await http.close();
  await fixture.dispose();
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  await writeFile(path.join(evidence, "summary.json"), JSON.stringify({
    specRevision: SPEC_REVISION, serverTarget: SERVER_TARGET, conformance: CONFORMANCE,
    inspector: INSPECTOR, packageVersion: packageJson.version, results,
    note: "Application server: fixture-specific suite failures are findings, never silently baselined. No runtime protocol or auth code changed."
  }, null, 2) + "\n");
}
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
