#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = process.env.HANDOFF_DEMO_HOME ?? path.resolve(".demo");
const registryFile = process.env.HANDOFF_MCP_REGISTRY ?? path.join(root, "agents.yaml");
const tokenFile = process.env.HANDOFF_DEMO_TOKENS ?? path.join(root, "tokens.env");
const identities = [
  ["chatgpt-demo", "ChatGPT demo", ["codex-demo"], ["codex-demo"]],
  ["codex-demo", "Codex demo", ["chatgpt-demo"], ["chatgpt-demo"]],
  ["operator-demo", "Human operator demo", ["chatgpt-demo", "codex-demo"], ["chatgpt-demo", "codex-demo"]],
];
const tokens = Object.fromEntries(identities.map(([id]) => [id, `handoff_${randomBytes(32).toString("base64url")}`]));
const agents = identities.map(([id, display_name, send_to, receive_from]) => ({ id, display_name, enabled: true, send_to, receive_from, disclosure_ceiling: "internal", token_sha256: createHash("sha256").update(tokens[id]).digest("hex"), expires_at: "2099-01-01T00:00:00Z" }));
mkdirSync(path.dirname(registryFile), { recursive: true, mode: 0o700 });
writeFileSync(registryFile, YAML.stringify({ version: 1, agents }), { mode: 0o600 });
writeFileSync(tokenFile, Object.entries(tokens).map(([id, token]) => `HANDOFF_TOKEN_${id.replaceAll("-", "_").toUpperCase()}=${token}`).join("\n") + "\n", { mode: 0o600 });
process.stdout.write(`Seeded ${identities.length} synthetic identities in ${registryFile}. Tokens written to ${tokenFile}; do not use in production.\n`);
