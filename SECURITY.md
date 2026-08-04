# Security

## Trust model

The operator controls the agent registry, database path, process environment, network exposure, and token distribution. MCP clients and all handoff fields are untrusted.

The server does not execute message content, invoke subprocesses, fetch URLs, follow file references, render HTML, or expose arbitrary filesystem/database tools.

## Secure defaults

- HTTP binds to `127.0.0.1` by default.
- HTTP authentication uses unique expiring bearer tokens; only SHA-256 hashes are stored.
- Token comparison is timing-safe.
- Host/origin validation, rate limiting, security headers, request-size limits, and HTTP timeouts are enabled.
- CORS and proxy trust are disabled unless explicitly configured.
- Inputs are parsed with strict bounded schemas.
- SQLite access uses fixed parameterized statements.
- Reads require sender or recipient identity.
- Lifecycle transitions are actor- and state-specific.
- There is no delete, arbitrary query, arbitrary file, URL-fetch, shell, agent-spawn, or remote-execution tool.

## Deployment requirements

Keep the registry, database, `.env`, and raw tokens outside source control. Give every client a unique token and rotate/revoke it independently. Remote deployments require TLS or a private authenticated network boundary. Configure `HANDOFF_MCP_TRUST_PROXY_HOPS` only when the actual proxy chain is known and overwrites forwarded headers.

The stdio identity is trusted process configuration. Do not let an untrusted caller choose `HANDOFF_AGENT_ID` or the registry/database paths.

## Content limitations

The database contains handoff content and may contain sensitive operational metadata. Protect and back it up accordingly. Prefer references to authoritative context over copying confidential source material into a handoff.

## Reporting

Do not open a public issue containing tokens, private handoffs, database extracts, or deployment details. Use GitHub's private vulnerability reporting when enabled.
