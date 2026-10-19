#!/usr/bin/env node
// Cold-install check for a published npm package (Week 43 exit evidence).
//
// Run it AFTER the release workflow has published the package, from any folder:
//   node scripts/cold-install-check.mjs <package> <version>
//
// It never publishes, tags or writes outside a fresh temporary folder. It
// installs the public artifact into an empty directory with an empty HOME, so
// nothing from the repository or the operator's machine can leak into the result.
// It prints a Markdown table to paste into docs/RELEASE_EVIDENCE_<date>.md.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [pkg, version] = process.argv.slice(2);
if (!pkg || !version) {
  console.error("usage: node scripts/cold-install-check.mjs <package> <version>");
  process.exit(2);
}

const win = process.platform === "win32";
const npm = (args, opts = {}) =>
  execFileSync("npm", args, { encoding: "utf8", shell: win, stdio: ["ignore", "pipe", "pipe"], ...opts });

const rows = [];
const record = (check, ok, detail) => {
  rows.push({ check, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${check}: ${detail}`);
};

// Per-package smoke commands. Both are offline and use only synthetic data.
const smoke = {
  "@sarutobi-sasuke/agent-handoff-mcp": (bin, home) => [
    { name: "init writes a registry", args: [bin("agent-handoff-mcp"), "init", "--registry", join(home, "agents.yaml")] },
    { name: "validate accepts it", args: [bin("agent-handoff-mcp"), "validate", "--registry", join(home, "agents.yaml")] },
  ],
  // The server is configured by environment and policy files, so the safe smoke
  // is that it refuses to start without them and says why. No GitHub request is made.
  "@sarutobi-sasuke/obsidian-github-mcp": (bin) => [
    { name: "refuses to start unconfigured (fail closed)", args: [bin("obsidian-github-mcp")], expectFail: true },
  ],
}[pkg];

const work = mkdtempSync(join(tmpdir(), "cold-install-"));
const home = join(work, "home");
const proj = join(work, "project");
try {
  // 1. The registry knows this exact version and says where it was built.
  const meta = JSON.parse(npm(["view", `${pkg}@${version}`, "--json"]));
  record("published version exists", meta.version === version, `${pkg}@${meta.version}`);
  record("registry integrity recorded", Boolean(meta.dist?.integrity), meta.dist?.integrity ?? "missing");
  record("provenance attestation present", Boolean(meta.dist?.attestations), meta.dist?.attestations?.url ?? "missing (not built through trusted publishing?)");

  // 2. Clean install into an empty folder.
  mkdirSync(proj, { recursive: true });
  mkdirSync(home, { recursive: true });
  npm(["init", "-y"], { cwd: proj });
  npm(["install", `${pkg}@${version}`, "--no-audit", "--no-fund"], { cwd: proj });
  const installed = JSON.parse(readFileSync(join(proj, "node_modules", ...pkg.split("/"), "package.json"), "utf8"));
  record("clean install", installed.version === version, `installed ${installed.version}`);

  // 3. Registry signatures and provenance verify on the installed tree.
  try {
    const out = npm(["audit", "signatures"], { cwd: proj });
    record("npm audit signatures", true, out.trim().split("\n").slice(-2).join(" | "));
  } catch (error) {
    record("npm audit signatures", false, String(error.stdout ?? error.message).trim().split("\n").slice(-2).join(" | "));
  }

  // 4. Every declared bin exists in the installed package.
  const root = join(proj, "node_modules", ...pkg.split("/"));
  const bins = typeof installed.bin === "string" ? { [installed.name]: installed.bin } : installed.bin ?? {};
  const missing = Object.entries(bins).filter(([, file]) => !existsSync(join(root, file))).map(([name]) => name);
  record("declared bins present", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : `${Object.keys(bins).length} bins`);
  const bin = (name) => join(root, bins[name]);

  // 5. Package-specific smoke, with an empty HOME and no inherited secrets.
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home };
  for (const step of smoke ? smoke(bin, home) : []) {
    const run = spawnSync(process.execPath, step.args, { cwd: proj, env, encoding: "utf8", timeout: 30_000 });
    const tail = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split("\n").slice(-2).join(" | ");
    const ok = step.expectFail ? run.status !== 0 && tail.length > 0 : run.status === 0;
    record(step.name, ok, `exit ${run.status}; ${tail.slice(0, 160)}`);
  }
} catch (error) {
  record("check aborted", false, String(error.stderr ?? error.message).trim().split("\n").slice(-3).join(" | "));
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log("\n| Check | Result | Detail |\n|---|---|---|");
for (const row of rows) console.log(`| ${row.check} | ${row.ok ? "Passed" : "FAILED"} | ${row.detail.replace(/\|/g, "\\|")} |`);
process.exit(rows.every((row) => row.ok) ? 0 : 1);
