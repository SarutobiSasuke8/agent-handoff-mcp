# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Agent Handoff Board packaging, 2026-10-08

- Add the Agent Handoff Board ChatGPT and Codex plugin package in `plugins/agent-handoff-board/` with four skills (create, accept, review, close) over the existing six tools, and `npm run check:plugin`. No tool or protocol changes.
- Add a single-tenant hosted demo recipe: `Dockerfile`, `deploy/board/compose.yaml` with a Traefik TLS proxy and per-IP rate limit, a demo seed script, an interim backup script and a test-case runner.
- Add review material in `docs/board/`: README, hosting recipe, privacy and terms drafts, demo workspace, 5 positive and 3 negative test cases, walkthrough.

### Release hardening, 2026-10-01

- Use Node 24 for npm trusted publishing and reject manual releases from branch refs.
- Refresh locked dependencies to clear the current npm audit findings without changing declared dependency ranges.
- Record 33 unit and 7 end-to-end checks, including clean tarball installation, transport revocation parity and restart persistence.

`0.1.0` is the first release candidate. It has not been published to npm and
no Git tag or GitHub release exists yet; everything below describes the
candidate on `main`.

### Added

- MCP server over both HTTP (Streamable HTTP) and stdio transports.
- Six core tools covering the handoff lifecycle: `handoff_whoami`,
  `handoff_send`, `handoff_inbox`, `handoff_get`, `handoff_acknowledge`, and
  `handoff_update_status`.
- Explicit agent relationships with per-pair disclosure ceilings, so an agent
  cannot receive material above the sensitivity its relationship permits.
- Structured handoff lifecycle with actor-scoped transitions. A sender may
  cancel, a recipient may accept, block, or complete, and no actor may perform
  the other's transitions.
- SQLite persistence with an append-only event log. Events are ordered
  deterministically by timestamp then insertion order.
- Idempotent sends keyed on `(sender, idempotencyKey)`, so a retried send
  returns the original handoff rather than creating a duplicate.
- Reply-chain depth guard to stop agents looping handoffs between themselves.
- Bearer token authentication. Tokens are stored in the registry only as
  SHA-256 digests, compared in constant time, and carry an expiry. Raw tokens
  are shown once at issue time and never persisted.
- Strict registry validation with immutable policy snapshots: unknown keys,
  duplicate ids/tokens/relationships, unknown targets, mixed wildcards,
  unsupported schema versions, and malformed expiry data are rejected with
  field-specific, redacted errors. Missing security fields are validation
  failures, never permissive defaults.
- Current-policy authorisation on every tool call: enabled state, expiry,
  relationships, disclosure ceiling, and participant role are rechecked before
  reads and transitions on both transports, so revocation takes effect on live
  sessions without a restart. Historical reads default to deny after
  relationship removal or ceiling reduction, and missing versus inaccessible
  handoffs share one error shape.
- Degraded-policy handling: a partial or invalid registry write keeps the
  prior valid policy active and is surfaced through `/healthz` and `/readyz`.
- `agent-handoff-mcp` dispatcher binary (subcommands `http`, `stdio`, `token`,
  `validate`, `init`, `issue`, `rotate`, `enable`, `disable`, `revoke`) plus a
  versioned registry JSON Schema in `schema/`.
- Test coverage for authorisation boundaries, lifecycle transitions,
  idempotency, event ordering, depth capping, registry strictness regressions,
  policy reload and degradation, and provisioning.
- End-to-end conformance suites: HTTP/stdio revocation parity with a real MCP
  client, token rotation, restart persistence, origin and rate-limit checks,
  and a clean-room install of the packed tarball driving both transports.
- CI matrix across Ubuntu and Windows on Node 22.13, 22.x, and 24.x, with a
  provenance-ready release workflow (npm trusted publishing, SBOM) that is
  gated on the owner registering the trusted publisher on npmjs.com.

### Packaging

- Prepared as `@sarutobi-sasuke/agent-handoff-mcp` (not yet published) with a
  default `agent-handoff-mcp` dispatcher binary and `agent-handoff-http`,
  `agent-handoff-stdio`, `agent-handoff-token`, and `agent-handoff-validate`
  aliases.
- The tarball ships the documentation and configuration the README references:
  `docs/`, `schema/`, `.env.example`, `config/agents.example.yaml`,
  `SECURITY.md`, `CHANGELOG.md`, `ROADMAP.md`, and `CONTRIBUTING.md`.
- Requires Node 22.13 or later.

[Unreleased]: https://github.com/SarutobiSasuke8/agent-handoff-mcp/commits/main
