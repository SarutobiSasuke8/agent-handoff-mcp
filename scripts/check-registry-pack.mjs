#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
// Pinned official MCP Registry schema; update the copy deliberately when the format changes.
const schema = JSON.parse(readFileSync(new URL("../schema/mcp-server-2025-12-11.json", import.meta.url), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(server)) {
  throw new Error(`server.json does not match the pinned MCP Registry schema: ${ajv.errorsText(validate.errors)}`);
}
if (server.$schema !== schema.$id || server.name !== packageJson.mcpName ||
    server.version !== packageJson.version ||
    !server.packages?.some((entry) => entry.registryType === "npm" &&
      entry.identifier === packageJson.name && entry.version === packageJson.version)) {
  throw new Error("Registry schema, name, version or npm package identity does not match package.json");
}

const npmCli = process.env.npm_execpath;
const output = npmCli
  ? execFileSync(process.execPath, [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" })
  : execFileSync(process.platform === "win32" ? "npm.cmd" : "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" });
const files = JSON.parse(output)[0]?.files?.map((entry) => entry.path) ?? [];
const required = ["README.md", "LICENSE"];
const missing = required.filter((name) => !files.includes(name));
if (!files.some((name) => /^dist\/.+\.js$/u.test(name))) missing.push("dist/*.js");
const forbidden = files.filter((name) =>
  /(^|\/)(?:\.env[^/]*|tests?|fixtures?|QA|session-logs?|release-evidence)(?:\/|$)/iu.test(name) ||
  /(?:^|\/)[^/]*transcript[^/]*$/iu.test(name) ||
  /(?:^|\/)[^/]*\.map$/iu.test(name) ||
  /(?:^|\/)[^/]*\.sqlite(?:$|[-.])/iu.test(name));
if (missing.length || forbidden.length) {
  throw new Error(`npm pack contents invalid. Missing: ${missing.join(", ") || "none"}; forbidden: ${forbidden.join(", ") || "none"}`);
}
process.stdout.write(`Registry schema and npm pack verified (${files.length} files).\n`);
