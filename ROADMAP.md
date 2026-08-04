# Roadmap

## v0.1 — protocol core

- [x] HTTP and stdio MCP transports
- [x] explicit agent relationships and disclosure ceilings
- [x] structured handoff lifecycle
- [x] SQLite persistence and append-only events
- [x] idempotent send retries and reply-depth guard
- [x] authorization and lifecycle tests

## Next

- [ ] MCP Inspector compatibility fixture and recorded demo
- [ ] Postgres store adapter for multi-host deployments
- [ ] optional inbox notifications without content leakage
- [ ] schema migrations and backup/restore commands
- [ ] token provisioning and revocation CLI
- [ ] OpenTelemetry-compatible operational metrics

## Optional modules, not core-tool expansion

- shared tasks and decisions
- broadcasts and audience groups
- presence and time-bounded leases
- context-pack promotion adapters
- human approval gates and remote dispatch adapters

The six core tools should remain small even as optional modules grow around them.
