#!/usr/bin/env node
/* global process, URL */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const required = ["plugin.json", "mcp.json", "skills/create.md", "skills/accept.md", "skills/review.md", "skills/close.md"];
const fail = (message) => { throw new Error(message); };
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const plugin = readJson("plugin.json");
const mcp = readJson("mcp.json");
for (const file of required) {
  const full = path.join(root, file);
  if (!statSync(full, { throwIfNoEntry: false })) fail(`missing ${file}`);
}
if (plugin.schema_version !== "v1" || plugin.name !== "agent-handoff-board") fail("invalid plugin identity");
if (plugin.transport !== "streamable-http" || !/^https:\/\/handoff\.astraeus\.ie\/mcp$/u.test(plugin.endpoint)) fail("invalid hosted endpoint");
if (!Array.isArray(plugin.tools) || plugin.tools.join(",") !== "handoff_send,handoff_acknowledge,handoff_inbox,handoff_get,handoff_update_status") fail("tool allowlist changed");
if (mcp.transport?.type !== "streamable-http" || mcp.transport?.url !== plugin.endpoint) fail("mcp transport does not match plugin");
if (mcp.auth?.type !== "bearer" || mcp.auth?.env !== "AGENT_HANDOFF_TOKEN") fail("bearer auth is required");
const files = readdirSync(root, { recursive: true }).filter((file) => !file.includes("\\") && !file.endsWith(".map"));
if (files.some((file) => /token|secret|\.sqlite/u.test(file))) fail("credential or database artefact in package");
process.stdout.write(`agent-handoff-board plugin valid (${required.length} required files)\n`);
