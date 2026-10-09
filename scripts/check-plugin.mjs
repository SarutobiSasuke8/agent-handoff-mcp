#!/usr/bin/env node
/**
 * Local validator for the Agent Handoff Board plugin package.
 *
 * OpenAI documents no official validator command for plugin packages, so this checks the
 * structural rules stated in https://developers.openai.com/plugins/build/plugins: a root
 * plugin.json with a kebab-case name, relative ./ paths that stay inside the package, an
 * mcp.json with Streamable HTTP servers, skills as skills/<name>/SKILL.md with name and
 * description frontmatter, and no bundled hooks (those make a plugin ineligible for the
 * public directory). It mirrors the JobScout Discover checker (jobscout-mcp PR #15).
 *
 * Board-specific rules, also failures:
 * - skills may only name the six existing MCP tools; the plugin adds no tools;
 * - each verb skill must use the tool it maps to (create, accept, review, close);
 * - no pricing, checkout or upsell copy anywhere in the package;
 * - no credential-like fields in mcp.json.
 *
 * Structural errors fail the run. Submission blockers (placeholder domain, portal-issued
 * app id, image assets) are reported separately because they need a live domain or design
 * work that cannot be faked. Pass --submission to turn blockers into failures.
 *
 * Usage: node scripts/check-plugin.mjs [pluginDir] [--submission]
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const KNOWN_TOOLS = [
  "handoff_whoami",
  "handoff_send",
  "handoff_inbox",
  "handoff_get",
  "handoff_acknowledge",
  "handoff_update_status",
];

const VERB_TOOLS = {
  "create-handoff": ["handoff_send"],
  "accept-handoff": ["handoff_acknowledge"],
  "review-handoffs": ["handoff_inbox", "handoff_get"],
  "close-handoff": ["handoff_update_status"],
};

// Hosts that are reserved for the hosted demo but have no DNS or deployment yet.
const PLACEHOLDER_HOSTS = ["handoff.astraeus.ie"];

const PRICING_PATTERN = /(?:[$€£]\s?\d|\b(?:pricing|price|prices|checkout|subscribe|subscription|per month|per seat|free trial|upgrade to)\b)/iu;

const args = process.argv.slice(2);
const strict = args.includes("--submission");
const positional = args.filter((arg) => !arg.startsWith("--"));
const defaultDir = fileURLToPath(new URL("../plugins/agent-handoff-board", import.meta.url));
const root = resolve(positional[0] ?? defaultDir);

const errors = [];
const blockers = [];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`${file}: cannot read as JSON (${error instanceof Error ? error.message : "unknown error"})`);
    return undefined;
  }
}

function checkRelativePath(value, label) {
  if (typeof value !== "string" || !value.startsWith("./")) {
    errors.push(`${label}: path must be a string starting with ./`);
    return;
  }
  const target = resolve(root, value);
  if (target !== root && !target.startsWith(root + sep)) errors.push(`${label}: path escapes the plugin root`);
  else if (!existsSync(target)) blockers.push(`${label}: ${value} does not exist`);
}

function checkPublicUrl(value, label) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    errors.push(`${label}: not a valid URL`);
    return;
  }
  if (url.protocol !== "https:") errors.push(`${label}: public submission needs an https URL`);
  if (/(^|\.)example\.(com|org|net)$/u.test(url.hostname) || /^replace/iu.test(url.hostname)) {
    blockers.push(`${label}: placeholder host ${url.hostname} must be replaced with a verified domain`);
  } else if (PLACEHOLDER_HOSTS.includes(url.hostname)) {
    blockers.push(`${label}: placeholder host ${url.hostname} has no DNS or deployment yet (operator step)`);
  }
}

function checkNoPricing(text, label) {
  const match = PRICING_PATTERN.exec(text);
  if (match) errors.push(`${label}: pricing or checkout copy ("${match[0]}") is not allowed in the package; link to the operator site instead`);
}

const manifestPath = join(root, "plugin.json");
if (!existsSync(manifestPath)) {
  errors.push("plugin.json is missing at the plugin root");
} else {
  const manifest = readJson(manifestPath);
  if (manifest) {
    checkNoPricing(readFileSync(manifestPath, "utf8"), "plugin.json");
    if (typeof manifest.name !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/u.test(manifest.name)) errors.push("name must be kebab-case");
    for (const field of ["version", "description", "license", "repository", "homepage"]) {
      if (typeof manifest[field] !== "string" || !manifest[field].trim()) errors.push(`${field} is required`);
    }
    if (!manifest.author || typeof manifest.author.name !== "string") errors.push("author.name is required");
    if (typeof manifest.homepage === "string") checkPublicUrl(manifest.homepage, "homepage");

    const openai = manifest.extensions?.["com.openai"];
    if (!openai) {
      errors.push("extensions.com.openai is required for ChatGPT and Codex");
    } else {
      if (openai.hooks) errors.push("bundled hooks make a plugin ineligible for the public directory");
      if (openai.apps) {
        checkRelativePath(openai.apps, "extensions.com.openai.apps");
      } else {
        blockers.push("extensions.com.openai.apps: .app.json needs a plugin_asdk_app_id issued by the submission portal");
      }
      const face = openai.interface;
      if (!face) {
        errors.push("extensions.com.openai.interface is required");
      } else {
        for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category", "websiteURL", "privacyPolicyURL", "termsOfServiceURL"]) {
          if (typeof face[field] !== "string" || !face[field].trim()) errors.push(`interface.${field} is required`);
        }
        for (const field of ["websiteURL", "privacyPolicyURL", "termsOfServiceURL"]) {
          if (face[field]) checkPublicUrl(face[field], `interface.${field}`);
        }
        if (!Array.isArray(face.defaultPrompt) || face.defaultPrompt.length === 0) errors.push("interface.defaultPrompt needs at least one example");
        for (const field of ["composerIcon", "logo"]) {
          if (face[field]) checkRelativePath(face[field], `interface.${field}`);
          else blockers.push(`interface.${field}: PNG asset not supplied`);
        }
        for (const [index, shot] of (face.screenshots ?? []).entries()) checkRelativePath(shot, `interface.screenshots[${index}]`);
        if (!face.screenshots?.length) blockers.push("interface.screenshots: no screenshots supplied");
      }
    }
  }
}

const mcpPath = join(root, "mcp.json");
if (existsSync(mcpPath)) {
  const mcp = readJson(mcpPath);
  const servers = mcp?.mcpServers;
  if (!servers || typeof servers !== "object" || Object.keys(servers).length === 0) {
    errors.push("mcp.json: mcpServers must name at least one server");
  } else {
    for (const [name, server] of Object.entries(servers)) {
      if (server.type !== "streamable-http") errors.push(`mcp.json: server ${name} must use type streamable-http`);
      checkPublicUrl(server.url, `mcp.json server ${name} url`);
      for (const key of Object.keys(server)) {
        if (/token|secret|password|key|header|auth/iu.test(key)) errors.push(`mcp.json: server ${name} carries a credential-like field (${key}); never store credentials in the package`);
      }
    }
  }
} else {
  errors.push("mcp.json is missing");
}

const skillsDir = join(root, "skills");
if (!existsSync(skillsDir)) {
  errors.push("skills/ directory is missing");
} else {
  const skills = readdirSync(skillsDir).filter((entry) => statSync(join(skillsDir, entry)).isDirectory());
  if (skills.length === 0) errors.push("skills/ contains no skills");
  for (const verb of Object.keys(VERB_TOOLS)) {
    if (!skills.includes(verb)) errors.push(`skills/${verb}: required verb skill is missing`);
  }
  for (const skill of skills) {
    const file = join(skillsDir, skill, "SKILL.md");
    if (!existsSync(file)) {
      errors.push(`skills/${skill}: SKILL.md is missing`);
      continue;
    }
    const text = readFileSync(file, "utf8");
    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(text);
    if (!front) {
      errors.push(`skills/${skill}/SKILL.md: frontmatter is missing`);
      continue;
    }
    const name = /^name:\s*(.+)$/mu.exec(front[1])?.[1]?.trim();
    const description = /^description:\s*(.+)$/mu.exec(front[1])?.[1]?.trim();
    if (!name) errors.push(`skills/${skill}/SKILL.md: name is missing`);
    else if (name !== skill) errors.push(`skills/${skill}/SKILL.md: name "${name}" must match the directory`);
    if (!description) errors.push(`skills/${skill}/SKILL.md: description is missing`);
    if (!front[2].trim()) errors.push(`skills/${skill}/SKILL.md: body is empty`);
    checkNoPricing(text, `skills/${skill}/SKILL.md`);

    const named = new Set(text.match(/\bhandoff_[a-z_]+\b/gu) ?? []);
    for (const tool of named) {
      if (!KNOWN_TOOLS.includes(tool)) errors.push(`skills/${skill}/SKILL.md: names unknown tool ${tool}; the plugin must not add or imply new tools`);
    }
    for (const tool of VERB_TOOLS[skill] ?? []) {
      if (!named.has(tool)) errors.push(`skills/${skill}/SKILL.md: must use ${tool}`);
    }
  }
}

if (existsSync(join(root, "hooks"))) errors.push("hooks/ directory present: ineligible for the public directory");

for (const message of blockers) console.log(`${strict ? "FAIL" : "submission blocker"}: ${message}`);
for (const message of errors) console.error(`FAIL: ${message}`);

if (errors.length || (strict && blockers.length)) {
  console.error(`Plugin check FAILED: ${errors.length} error(s), ${blockers.length} submission blocker(s).`);
  process.exit(1);
}
console.log(`Plugin check passed with ${blockers.length} documented submission blocker(s). Structure is valid; not yet submission-ready.`);
