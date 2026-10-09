import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const script = join(repo, "scripts", "check-plugin.mjs");
const pluginDir = join(repo, "plugins", "agent-handoff-board");

function run(dir: string, ...extra: string[]): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [script, dir, ...extra], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function withCopy(edit: (dir: string) => void): { status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "handoff-board-plugin-"));
  try {
    cpSync(pluginDir, dir, { recursive: true });
    edit(dir);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function editSkill(dir: string, skill: string, transform: (text: string) => string): void {
  const file = join(dir, "skills", skill, "SKILL.md");
  writeFileSync(file, transform(readFileSync(file, "utf8")));
}

void test("the shipped Agent Handoff Board package is structurally valid", () => {
  const { status, output } = run(pluginDir);
  assert.equal(status, 0, output);
});

void test("submission mode fails while the placeholder host and assets remain", () => {
  const { status, output } = run(pluginDir, "--submission");
  assert.equal(status, 1);
  assert.match(output, /placeholder host handoff\.astraeus\.ie/u);
});

void test("skills name only tools the server actually registers", () => {
  const server = readFileSync(join(repo, "src", "server.ts"), "utf8");
  const registered = new Set([...server.matchAll(/registerTool\(\s*"([a-z_]+)"/gu)].map((match) => match[1]));
  assert.equal(registered.size, 6);
  const checker = readFileSync(script, "utf8");
  for (const tool of registered) assert.match(checker, new RegExp(`"${tool}"`, "u"));
  for (const skill of readdirSync(join(pluginDir, "skills"))) {
    const text = readFileSync(join(pluginDir, "skills", skill, "SKILL.md"), "utf8");
    for (const tool of text.match(/\bhandoff_[a-z_]+\b/gu) ?? []) assert.ok(registered.has(tool), `${skill} names ${tool}`);
  }
});

void test("a skill that implies a new tool is rejected", () => {
  const { status, output } = withCopy((dir) => editSkill(dir, "review-handoffs", (text) => `${text}\nCall handoff_annotate to comment.\n`));
  assert.equal(status, 1);
  assert.match(output, /unknown tool handoff_annotate/u);
});

void test("a verb skill that loses its mapped tool is rejected", () => {
  const { status, output } = withCopy((dir) => editSkill(dir, "close-handoff", (text) => text.replaceAll("handoff_update_status", "the status tool")));
  assert.equal(status, 1);
  assert.match(output, /must use handoff_update_status/u);
});

void test("pricing copy in the package is rejected", () => {
  const { status, output } = withCopy((dir) => editSkill(dir, "create-handoff", (text) => `${text}\nUpgrade to the team plan for EUR 49 per month.\n`));
  assert.equal(status, 1);
  assert.match(output, /pricing or checkout copy/u);
});

void test("a credential-like field in mcp.json is rejected", () => {
  const { status, output } = withCopy((dir) => writeFileSync(join(dir, "mcp.json"), JSON.stringify({
    mcpServers: { "agent-handoff": { type: "streamable-http", url: "https://handoff.astraeus.ie/mcp", bearerToken: "x" } },
  })));
  assert.equal(status, 1);
  assert.match(output, /credential-like/u);
});

void test("a non-kebab-case name is rejected", () => {
  const { status, output } = withCopy((dir) => {
    const file = join(dir, "plugin.json");
    const manifest = JSON.parse(readFileSync(file, "utf8")) as { name: string };
    manifest.name = "Agent_Handoff_Board";
    writeFileSync(file, JSON.stringify(manifest));
  });
  assert.equal(status, 1);
  assert.match(output, /kebab-case/u);
});
