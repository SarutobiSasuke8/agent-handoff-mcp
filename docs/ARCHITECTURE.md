# Architecture

```mermaid
flowchart LR
    Claude["Claude MCP client"] -->|HTTP bearer or stdio identity| MCP["Agent Handoff MCP"]
    Codex["Codex MCP client"] -->|HTTP bearer or stdio identity| MCP
    Other["Other registered agent"] -->|bounded identity| MCP
    MCP --> Registry["Operator-owned agent registry"]
    MCP --> Service["Authorization and lifecycle service"]
    Service --> SQLite["SQLite handoffs and append-only events"]
```

## Layers

`registry.ts` parses the operator-owned identity and communication policy. It is re-read for identity and authorization checks, so disabling an identity or narrowing a relationship does not require rebuilding the server.

`service.ts` owns participant authorization, disclosure checks, message limits, and the public handoff operations.

`store.ts` owns SQLite schema, transactions, idempotency, lifecycle transitions, and the event history. SQL statements are fixed and parameterized.

`server.ts` maps the service to six MCP tools with strict Zod input schemas.

`http.ts` provides a shared Streamable HTTP service with hashed bearer-token verification, host/origin validation, rate limiting, security headers, body limits, and bounded timeouts.

`stdio.ts` provides local process transport. Identity comes from `HANDOFF_AGENT_ID`; the client configuration is therefore part of the trust boundary.

## Storage choice

SQLite keeps the first deployment operationally small while providing transactions, indexes, concurrent WAL readers, and a clean migration path. The service/store boundary permits a future Postgres adapter without changing MCP tools.

Operational database files and real agent registries are intentionally ignored by Git.

## Public engine and private deployment

The public repository owns the generic protocol and implementation. A private deployment repository can depend on it and add real identities, secrets, infrastructure, private context conventions, and operator runbooks. This avoids maintaining a private fork of the engine.
