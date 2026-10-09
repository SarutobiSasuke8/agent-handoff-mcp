#!/usr/bin/env node
// Contract-suite target for mcp-eval. Not shipped, not used by the server.
//
// Builds a throwaway world in a fresh OS temp directory, then runs the real stdio
// entrypoint (dist/src/stdio.js) against it:
//   - agents.yaml: a generated test policy with three synthetic identities. Each token is
//     random, only its SHA-256 is written, and the token itself is discarded. stdio does not
//     authenticate with tokens; the hashes exist so the registry has the production shape.
//   - handoffs.sqlite: a temp SQLite store seeded with two fixed handoffs (fixed ids and
//     timestamps), so goldens are deterministic and deny paths have a known handoff to aim at.
// The temp directory is removed when the server exits. Nothing outside it is read or written,
// and no network is used.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stdioEntry = path.resolve(here, "..", "dist", "src", "stdio.js");
const { HandoffStore } = await import(pathToFileURL(path.resolve(here, "..", "dist", "src", "store.js")).href);

const dir = mkdtempSync(path.join(tmpdir(), "agent-handoff-eval-"));
const registryFile = path.join(dir, "agents.yaml");
const databaseFile = path.join(dir, "handoffs.sqlite");

function tokenHash() {
  return createHash("sha256").update(randomBytes(32).toString("base64url"), "utf8").digest("hex");
}

// eval-alpha is the stdio identity under test. eval-beta is its only permitted peer, with an
// internal ceiling. eval-gamma is enabled but outside eval-alpha's policy in both directions.
writeFileSync(registryFile, [
  "version: 1",
  "agents:",
  "  - id: eval-alpha",
  "    display_name: Eval Alpha",
  "    enabled: true",
  "    send_to: [eval-beta]",
  "    receive_from: [eval-beta]",
  "    disclosure_ceiling: restricted",
  `    token_sha256: "${tokenHash()}"`,
  "    expires_at: 2099-01-01T00:00:00Z",
  "  - id: eval-beta",
  "    display_name: Eval Beta",
  "    enabled: true",
  "    send_to: [eval-alpha]",
  "    receive_from: [eval-alpha]",
  "    disclosure_ceiling: internal",
  `    token_sha256: "${tokenHash()}"`,
  "    expires_at: 2099-01-01T00:00:00Z",
  "  - id: eval-gamma",
  "    display_name: Eval Gamma",
  "    enabled: true",
  "    send_to: []",
  "    receive_from: []",
  "    disclosure_ceiling: internal",
  `    token_sha256: "${tokenHash()}"`,
  "    expires_at: 2099-01-01T00:00:00Z",
  "",
].join("\n"));

// Let the store create its own schema, then seed rows with fixed ids and timestamps.
new HandoffStore(databaseFile).close();
const db = new DatabaseSync(databaseFile);
const insertHandoff = db.prepare(`
  INSERT INTO handoffs (
    id, thread_id, parent_id, depth, sender, recipient, title, summary, request,
    context_refs_json, artifact_refs_json, tags_json, sensitivity, priority, status,
    created_at, updated_at, idempotency_key, payload_hash
  ) VALUES (?, ?, NULL, 0, 'eval-beta', 'eval-alpha', ?, ?, ?, ?, '[]', ?, 'internal', ?, 'queued', ?, ?, NULL, NULL)
`);
const insertEvent = db.prepare(`
  INSERT INTO handoff_events (id, handoff_id, actor, event_type, from_status, to_status, note, created_at)
  VALUES (?, ?, 'eval-beta', 'created', NULL, 'queued', NULL, ?)
`);
const seeds = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    eventId: "00000000-0000-4000-8000-0000000000e1",
    title: "Review the release notes",
    summary: "Draft release notes for version 0.1.0 are ready.",
    request: "Check the draft for accuracy and reply with corrections.",
    contextRefs: ["docs/release-notes-draft.md"],
    tags: ["release"],
    priority: "normal",
    at: "2026-01-01T09:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    eventId: "00000000-0000-4000-8000-0000000000e2",
    title: "Triage the open bug report",
    summary: "A synthetic bug report is waiting for triage.",
    request: "Acknowledge and decide whether it needs a fix this week.",
    contextRefs: [],
    tags: ["triage"],
    priority: "high",
    at: "2026-01-01T10:00:00.000Z",
  },
];
for (const seed of seeds) {
  insertHandoff.run(
    seed.id, seed.id, seed.title, seed.summary, seed.request,
    JSON.stringify(seed.contextRefs), JSON.stringify(seed.tags), seed.priority, seed.at, seed.at,
  );
  insertEvent.run(seed.eventId, seed.id, seed.at);
}
db.close();

function cleanUp() {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort: the OS temp directory is cleared eventually anyway.
  }
}

const child = spawn(process.execPath, [stdioEntry], {
  stdio: "inherit",
  env: {
    ...process.env,
    HANDOFF_MCP_DB: databaseFile,
    HANDOFF_MCP_REGISTRY: registryFile,
    HANDOFF_AGENT_ID: "eval-alpha",
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => {
  cleanUp();
  process.exit(code ?? 1);
});
