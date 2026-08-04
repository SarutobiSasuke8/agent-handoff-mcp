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
| `handoff_whoami` | Show the authenticated identity and communication boundaries. |
| `handoff_send` | Send a structured handoff to an authorized recipient. |
| `handoff_inbox` | List handoffs addressed to the current identity. |
| `handoff_get` | Read a handoff and its append-only event history. |
| `handoff_acknowledge` | Accept queued or blocked work. |
| `handoff_update_status` | Mark work blocked/completed, or cancel it while queued. |

## Design properties

- SQLite shared state with WAL mode and parameterized queries
- Streamable HTTP and stdio transports
- Opaque UUID handoff, event, and thread identifiers
- Explicit `send_to` and `receive_from` authorization
- Per-agent disclosure ceilings: `public-safe`, `internal`, or `restricted`
- Hashed, expiring bearer-token bindings for HTTP
- Idempotency keys for safe retries
- Maximum reply-chain depth to limit automated ping-pong
- Strict message, array, reference, and request-size limits
- Sender/recipient-only reads
- Append-only lifecycle events; no MCP delete tool
- References are stored as inert strings and never dereferenced

## Quick start

Requirements: Node.js 22.13 or newer.

```bash
git clone https://github.com/SarutobiSasuke8/agent-handoff-mcp.git
cd agent-handoff-mcp
npm ci
cp .env.example .env
cp config/agents.example.yaml config/agents.yaml
npm run token:new
```

Replace the disabled example token hashes and expiry timestamps in `config/agents.yaml`, then start the shared HTTP service:

```bash
npm run check
npm start
```

The default endpoints are:

```text
GET  http://127.0.0.1:3220/healthz
POST http://127.0.0.1:3220/mcp
Authorization: Bearer handoff_<agent-specific-token>
```

The server binds to localhost by default. Put an authenticated private-network or TLS boundary in front of it before any remote deployment.

## Stdio mode

Each stdio client supplies its identity through its own process environment while sharing the same SQLite database and registry:

```json
{
  "command": "node",
  "args": ["/absolute/path/agent-handoff-mcp/dist/src/stdio.js"],
  "env": {
    "HANDOFF_AGENT_ID": "example-codex",
    "HANDOFF_MCP_DB": "/absolute/shared/path/handoffs.sqlite",
    "HANDOFF_MCP_REGISTRY": "/absolute/path/agents.yaml"
  }
}
```

Use HTTP when multiple clients should connect to one long-running service. Use stdio for local clients that can safely receive a fixed identity through their own configuration.

## Documentation

- [Protocol and lifecycle](docs/PROTOCOL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security model](SECURITY.md)
- [Roadmap](ROADMAP.md)

## Scope boundary

This project is a coordination primitive, not a general task platform. Shared task boards, decisions, broadcasts, presence, leases, notifications, context promotion, and remote dispatch belong behind future optional modules. The six-tool handoff surface remains the stable core.

## License

Apache-2.0. See [LICENSE](LICENSE).
