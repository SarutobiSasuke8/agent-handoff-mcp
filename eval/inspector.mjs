// Real Inspector CLI compatibility, separate from the SDK contract harness.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inspectorVersion = "2.11.0";
// npm's own CLI avoids shell quoting on Windows, including JSON tool args.
const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const fixture = (name) => JSON.parse(readFileSync(path.join(root, "eval/fixtures", name), "utf8"));

function run(method, tool, input = {}, acceptedSeed = false) {
  const args = ["exec", "--yes", `--package=@modelcontextprotocol/inspector@${inspectorVersion}`, "--", "mcp-inspector", "--cli",
    "--format", "json", "--quiet", "--method", method];
  if (tool) args.push("--tool-name", tool, "--tool-args-json", JSON.stringify(input));
  args.push("--", process.execPath, "eval/target.mjs");
  if (acceptedSeed) args.push("--accept-second");
  // POSIX installations keep npm under ../lib/node_modules or a package-manager
  // prefix, so use its PATH executable rather than guessing its module path.
  const invocation = process.platform === "win32" ? [process.execPath, [npmCli, ...args]] : ["npm", args];
  const child = spawnSync(invocation[0], invocation[1], {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
    // No env-file flag, real token, live registry, database, or external endpoint.
    env: { ...process.env, MCP_STORAGE_DIR: path.join(root, "node_modules/.cache/inspector-fixture") },
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, `${tool ?? method}: Inspector failed\n${child.stderr}\n${child.stdout}`);
  const envelope = JSON.parse(child.stdout.trim());
  const result = envelope.result;
  assert.ok(result && !result.isError, `${tool ?? method}: missing or failed MCP result`);
  if (!tool) return result;
  const text = result.content?.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  const value = result.structuredContent ?? JSON.parse(text);
  assert.deepEqual(JSON.parse(text), value, `${tool}: text and structured content differ`);
  return value;
}

function compare(tool, input, golden, ignorePaths = [], acceptedSeed = false) {
  const actual = run("tools/call", tool, input, acceptedSeed);
  for (const dotted of ignorePaths) {
    const parts = dotted.split(".");
    const key = parts.pop();
    let object = actual;
    for (const part of parts) object = object[part];
    assert.ok(Object.hasOwn(object, key), `${tool}: expected dynamic field ${dotted}`);
    delete object[key];
  }
  assert.deepEqual(actual, golden, `${tool}: golden mismatch`);
  process.stdout.write(`PASS ${tool}: existing golden matched\n`);
}

process.stdout.write(`MCP Inspector ${inspectorVersion}; built stdio server; synthetic temp workspace per invocation\n`);
const listed = run("tools/list");
const tools = ["handoff_whoami", "handoff_send", "handoff_inbox", "handoff_get", "handoff_acknowledge", "handoff_update_status"];
assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [...tools].sort());
for (const tool of listed.tools) {
  assert.deepEqual(tool.inputSchema, fixture(`${tool.name.replace("handoff_", "")}.input.schema.json`), `${tool.name}: input schema changed`);
}
process.stdout.write("PASS tools/list: exactly six tools and all existing input-schema goldens matched\n");
compare("handoff_whoami", {}, fixture("whoami.golden.json"), ["policy_revision"]);
compare("handoff_inbox", {}, fixture("inbox.golden.json"));
compare("handoff_get", { handoff_id: "00000000-0000-4000-8000-000000000001" }, fixture("get.golden.json"));
compare("handoff_send", { recipient: "eval-beta", title: "Summarise the contract suite", summary: "The mcp-eval suite needs a short summary for the README.", request: "Write three sentences on what the suite covers.", tags: ["docs"] }, fixture("send.golden.json"), ["handoff.id", "handoff.threadId", "handoff.createdAt", "handoff.updatedAt"]);
compare("handoff_acknowledge", { handoff_id: "00000000-0000-4000-8000-000000000002", note: "On it." }, fixture("acknowledge.golden.json"), ["handoff.updatedAt"]);
// The existing acknowledge golden is the same seeded record. A completed
// transition changes only status and updatedAt; no response-derived expectation.
const completed = fixture("acknowledge.golden.json");
completed.handoff.status = "completed";
compare("handoff_update_status", { handoff_id: "00000000-0000-4000-8000-000000000002", status: "completed", note: "Synthetic review complete." }, completed, ["handoff.updatedAt"], true);
process.stdout.write("PASS Inspector compatibility: tools/list plus one successful call per tool\n");
