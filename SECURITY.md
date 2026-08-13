# Security

## Trust model

The operator controls the agent registry, database path, process environment, network exposure, and token distribution. MCP clients and all handoff fields are untrusted.

The server does not execute message content, invoke subprocesses, fetch URLs, follow file references, render HTML, or expose arbitrary filesystem/database tools.

## Policy validation

- The registry schema is strict. Unknown keys, duplicate ids, duplicate token hashes, duplicate relationship entries, unknown relationship targets, wildcards mixed with explicit entries, unsupported schema versions, and malformed expiry data are all rejected with field-specific errors.
- Error messages never echo token material or other field values.
- There are no permissive defaults: `enabled`, `send_to`, `receive_from`, and `disclosure_ceiling` must be stated explicitly for every identity. A missing or misspelled security field is a validation failure, never an implicit grant.
- Every operation validates against one immutable policy snapshot, identified by a content revision that `handoff_whoami` reports as `policy_revision`.
- A partial or invalid registry write never takes effect: the last valid policy stays active and the server reports itself degraded through `/healthz` and `/readyz` until the registry is repaired.
- `agent-handoff-mcp validate --registry <path>` (also installed as `agent-handoff-validate`) checks a registry without opening the database or reading raw tokens. A versioned JSON Schema ships in `schema/agent-registry.schema.v1.json`.

## Authorisation and revocation

- All six tools resolve the authenticated principal against the current policy snapshot on every call. Enabled state, credential expiry, relationships, disclosure ceiling, and participant role are rechecked before reads and transitions, not only sends.
- Registry changes are observed by mtime on both transports, so disabling an identity, rotating a token, removing a relationship, or reducing a ceiling takes effect on live HTTP and stdio sessions without a restart.
- Historical reads default to deny: once a relationship is removed or a ceiling drops below a stored handoff's sensitivity, neither participant identity can read it until the operator restores the policy.
- Missing and inaccessible handoffs produce the same error shape, so a revoked or unrelated principal cannot use error text as an existence oracle.

## Secure defaults

- HTTP binds to `127.0.0.1` by default.
- HTTP authentication uses unique expiring bearer tokens; only SHA-256 hashes are stored.
- Token comparison is timing-safe.
- Host/origin validation, rate limiting, security headers, request-size limits, and HTTP timeouts are enabled.
- CORS and proxy trust are disabled unless explicitly configured.
- MCP tool inputs are parsed with strict bounded schemas; unknown argument keys are rejected rather than silently dropped.
- SQLite access uses fixed parameterised statements.
- Reads require sender or recipient identity under the current policy.
- Lifecycle transitions are actor- and state-specific.
- There is no delete, arbitrary query, arbitrary file, URL-fetch, shell, agent-spawn, or remote-execution tool.

## Deployment requirements

Keep the registry, database, `.env`, and raw tokens outside source control. Give every client a unique token and rotate/revoke it independently with `agent-handoff-mcp rotate` and `agent-handoff-mcp revoke`. Remote deployments require TLS or a private authenticated network boundary. Configure `HANDOFF_MCP_TRUST_PROXY_HOPS` only when the actual proxy chain is known and overwrites forwarded headers.

The stdio identity is trusted process configuration. Do not let an untrusted caller choose `HANDOFF_AGENT_ID` or the registry/database paths. On POSIX systems the provisioning commands refuse to write a registry that is readable by group or other users.

## Content limitations

The database contains handoff content and may contain sensitive operational metadata. Protect and back it up accordingly. Prefer references to authoritative context over copying confidential source material into a handoff.

## Reporting

Do not open a public issue containing tokens, private handoffs, database extracts, or deployment details. Use GitHub's private vulnerability reporting when enabled.
