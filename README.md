# Agent Handoff MCP

A local-first Model Context Protocol server for bounded, auditable handoffs between AI agents.

Agent Handoff MCP gives Claude, Codex, local agents, and other MCP clients a shared inbox without giving one model control over another. Agents can send structured work, acknowledge it, report a blocker, complete it, or cancel work they originally queued. Every transition is attributable and retained in SQLite.

## Why this exists

Multi-agent systems often pass work through chat transcripts, ad hoc files, or vendor-specific orchestration. That loses ownership, lifecycle state, authorization boundaries, and a durable audit trail. This server turns a handoff into a small protocol object:

```text
sender -> queued -> accepted -> completed
                   |             ^
                   v             |
                 blocked --------+

sender may cancel only while queued
```

The server coordinates work; it does not execute agents, fetch references, read arbitrary files, or create autonomous agent loops.

## MCP tools

| Tool | Purpose |
|---|---|
| `handoff_whoami` | Show the authenticated identity, boundaries, and policy revision. |
| `handoff_send` | Send a structured handoff to an authorized recipient. |
| `handoff_inbox` | List handoffs addressed to the current identity. |
| `handoff_get` | Read a handoff and its append-only event history. |
| `handoff_acknowledge` | Accept queued or blocked work. |
| `handoff_update_status` | Mark work blocked/completed, or cancel it while queued. |

## Design properties

- SQLite shared state with WAL mode and parameterized queries
- Streamable HTTP and stdio transports
- Opaque UUID handoff, event, and thread identifiers
- Explicit `send_to` and `receive_from` authorization with no permissive defaults
- Per-agent disclosure ceilings: `public-safe`, `internal`, or `restricted`
- Strict registry validation: unknown keys, duplicates, and unsupported versions are rejected
- Immutable policy snapshots: every operation is checked against the current registry, so disabling an identity, rotating a token, or narrowing a relationship takes effect on live sessions without a restart
- Hashed, expiring bearer-token bindings for HTTP
- Idempotency keys for safe retries
- Maximum reply-chain depth to limit automated ping-pong
- Strict message, array, reference, and request-size limits
- Sender/recipient-only reads, re-authorized against current policy
- Append-only lifecycle events; no MCP delete tool
- References are stored as inert strings and never dereferenced

## Command line

The package installs one dispatcher binary, `agent-handoff-mcp`, whose name matches the package so `npx @sarutobi-sasuke/agent-handoff-mcp <command>` resolves directly once the package is published to npm. (It is not published yet; use a source checkout until then.)

| Command | Purpose |
|---|---|
| `http` | Start the shared Streamable HTTP server. |
| `stdio` | Start a stdio server bound to `HANDOFF_AGENT_ID`. |
| `init --registry <path>` | Create a starter registry with disabled synthetic identities. |
| `validate --registry <path>` | Validate a registry without reading tokens or the database. |
| `issue --registry <path> --agent <id> --expires <iso8601>` | Issue an expiring token, printed once to stdout. |
| `rotate ...` | Replace an existing token; the old one stops working immediately. |
| `disable` / `enable` | Toggle an identity across all transports. |
| `revoke` | Remove an identity's token binding. |
| `token` | Generate a token and digest without touching a registry. |

`agent-handoff-http`, `agent-handoff-stdio`, `agent-handoff-token`, and `agent-handoff-validate` are also installed as direct aliases.

## Quick start

Requirements: Node.js 22.13 or newer.

For a source checkout:

```bash
git clone https://github.com/SarutobiSasuke8/agent-handoff-mcp.git
cd agent-handoff-mcp
npm ci
npm run build
cp .env.example .env
node dist/src/cli.js init --registry ./config/agents.yaml
node dist/src/cli.js issue --registry ./config/agents.yaml --agent example-alpha --expires 2027-01-01T00:00:00Z
node dist/src/cli.js issue --registry ./config/agents.yaml --agent example-beta --expires 2027-01-01T00:00:00Z
node dist/src/cli.js enable --registry ./config/agents.yaml --agent example-alpha
node dist/src/cli.js enable --registry ./config/agents.yaml --agent example-beta
node dist/src/cli.js validate --registry ./config/agents.yaml
npm run check
npm start
```

Each `issue` command prints that identity's raw token exactly once; hand it to that client over a secure channel. Only SHA-256 digests are stored. See [docs/QUICKSTART.md](docs/QUICKSTART.md) for complete PowerShell and POSIX clean-room flows.

The default endpoints are:

```text
GET  http://127.0.0.1:3220/healthz   liveness and policy state
GET  http://127.0.0.1:3220/readyz    readiness; 503 while the policy is degraded
POST http://127.0.0.1:3220/mcp
Authorization: Bearer handoff_<agent-specific-token>
```

The server binds to localhost by default. Put an authenticated private-network or TLS boundary in front of it before any remote deployment.

## Stdio mode

Each stdio client supplies its identity through its own process environment while sharing the same SQLite database and registry:

```json
{
  "command": "node",
  "args": ["/absolute/path/agent-handoff-mcp/dist/src/cli.js", "stdio"],
  "env": {
    "HANDOFF_AGENT_ID": "example-beta",
    "HANDOFF_MCP_DB": "/absolute/shared/path/handoffs.sqlite",
    "HANDOFF_MCP_REGISTRY": "/absolute/path/agents.yaml"
  }
}
```

Use HTTP when multiple clients should connect to one long-running service. Use stdio for local clients that can safely receive a fixed identity through their own configuration. Both transports re-check the registry on every operation, so revocation applies to running stdio sessions too.

## Documentation

- [Clean-room quickstart](docs/QUICKSTART.md)
- [Protocol and lifecycle](docs/PROTOCOL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security model](SECURITY.md)
- [Registry JSON Schema](schema/agent-registry.schema.v1.json)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)

## Scope boundary

This project is a coordination primitive, not a general task platform. Shared task boards, decisions, broadcasts, presence, leases, notifications, context promotion, and remote dispatch belong behind future optional modules. The six-tool handoff surface remains the stable core.

## License

Apache-2.0. See [LICENSE](LICENSE).
