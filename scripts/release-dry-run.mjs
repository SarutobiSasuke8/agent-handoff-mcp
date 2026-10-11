#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "release-evidence", new Date().toISOString().replaceAll(/[:.]/gu, "-"));
mkdirSync(output, { recursive: true });
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run via npm run release:dry-run so the npm CLI is known.");
function run(label, executable, args) {
  process.stdout.write(`${label}\n`);
  const result = spawnSync(executable, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(path.join(output, `${label}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  if (result.error || result.status !== 0) throw new Error(`${label} failed; inspect its release-evidence log. No release action was taken.`);
  return result.stdout;
}
const npm = (label, args) => run(label, process.execPath, [npmCli, ...args]);
npm("install", ["ci"]);
npm("check", ["run", "check"]);
npm("e2e", ["run", "test:e2e"]);
const verified = run("verify-pack", process.execPath, ["scripts/verify-pack.mjs"]);
const sbom = npm("sbom", ["sbom", "--sbom-format=spdx", "--omit=dev"]);
const packageCount = JSON.parse(sbom).packages.length;
writeFileSync(path.join(output, "sbom.spdx.json"), sbom);
const packed = JSON.parse(npm("pack", ["pack", "--json", "--pack-destination", output]));
if (packed.length !== 1 || path.basename(packed[0].filename) !== packed[0].filename) throw new Error("Unexpected pack manifest.");
const filename = packed[0].filename;
const sha256 = createHash("sha256").update(readFileSync(path.join(output, filename))).digest("hex");
writeFileSync(path.join(output, "checksums.sha256"), `${sha256}  ${filename}\n`);
const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
const summary = { created: new Date().toISOString(), node: process.version,
  npm: npm("npm-version", ["--version"]).trim(), revision: revision.status === 0 ? revision.stdout.trim() : null,
  dirty: dirty.status === 0 ? dirty.stdout.trim().length > 0 : null,
  tarball: filename, sha256, sbomPackages: packageCount, verifyPack: verified.trim(),
  scope: "Local check, e2e, allowlist, SPDX SBOM and tarball evidence only; no tags, releases or registry writes." };
writeFileSync(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\nEvidence: ${output}\n`);
