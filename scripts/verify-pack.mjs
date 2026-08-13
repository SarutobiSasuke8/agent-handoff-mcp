#!/usr/bin/env node
// Release gate: verify the packed tarball contains exactly the files the
// README and documentation promise, and none of the operator-private ones.
import { execFileSync } from "node:child_process";

const manifest = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8", shell: process.platform === "win32" }),
);
const files = manifest[0].files.map((file) => file.path);

const required = [
  "dist/src/cli.js",
  "dist/src/http.js",
  "dist/src/stdio.js",
  "dist/src/bin-validate.js",
  "dist/src/server.js",
  "scripts/generate-token.mjs",
  "config/agents.example.yaml",
  "schema/agent-registry.schema.v1.json",
  "docs/ARCHITECTURE.md",
  "docs/PROTOCOL.md",
  "docs/QUICKSTART.md",
  ".env.example",
  "README.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "ROADMAP.md",
  "CONTRIBUTING.md",
  "LICENSE",
];
const forbiddenPatterns = [
  /^config\/agents\.yaml$/u,
  /^data\//u,
  /\.env$/u,
  /\.sqlite/u,
  /^test\//u,
  /^dist\/test\//u,
];

const missing = required.filter((file) => !files.includes(file));
const forbidden = files.filter((file) => forbiddenPatterns.some((pattern) => pattern.test(file)));

if (missing.length > 0 || forbidden.length > 0) {
  if (missing.length > 0) process.stderr.write(`Tarball is missing required files:\n${missing.map((f) => `  - ${f}`).join("\n")}\n`);
  if (forbidden.length > 0) process.stderr.write(`Tarball contains forbidden files:\n${forbidden.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Tarball allowlist verified: ${files.length} files, all required present, none forbidden.\n`);
