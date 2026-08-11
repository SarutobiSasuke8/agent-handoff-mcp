# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-04

First release. The protocol core is complete and the six core tools are
considered stable.

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
  are shown once by the generation script (`npm run token:new`) and never
  persisted.
- Test coverage for authorisation boundaries, lifecycle transitions,
  idempotency, event ordering, and depth capping.
- CI running typecheck, lint, and the test suite on every push and pull
  request.

### Packaging

- Prepared as `@sarutobi-sasuke/agent-handoff-mcp` with three binaries:
  `agent-handoff-http`, `agent-handoff-stdio`, and `agent-handoff-token`.
- Requires Node 22.13 or later.

[Unreleased]: https://github.com/SarutobiSasuke8/agent-handoff-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SarutobiSasuke8/agent-handoff-mcp/releases/tag/v0.1.0
