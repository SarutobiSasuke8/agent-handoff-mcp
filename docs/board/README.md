# Agent Handoff Board demo

This package is a submission-ready hosted-demo recipe for the existing Agent Handoff MCP protocol. It is governed AgentOps infrastructure, not a chat wrapper. The hosted URL is a placeholder: `https://handoff.astraeus.ie/mcp`.

## Local proof

```sh
npm ci
npm run check
npm run check:plugin
node scripts/seed-demo.mjs
# Start a local server with HANDOFF_MCP_REGISTRY and HANDOFF_MCP_DB set.
node scripts/board-demo-check.mjs
```

The seed writes three synthetic identities and one-time demo tokens to an operator-selected directory. Never commit the generated registry, token file or SQLite database.

## Hosted recipe

1. Provision a single tenant VM, Docker Engine and a DNS A/AAAA record for `handoff.astraeus.ie`.
2. Copy `deploy/board/.env.example` to `deploy/board/.env`, restrict it to the operator, and provision `deploy/board/certs/fullchain.pem` and `privkey.pem` from the chosen TLS authority.
3. Build and start: `docker compose -f deploy/board/compose.yml up -d --build`.
4. Confirm `docker compose -f deploy/board/compose.yml ps`, then run `curl -fsS https://handoff.astraeus.ie/healthz` and `/readyz`.
5. Provision real identities with the existing bearer-token CLI. Copy raw tokens directly to the intended ChatGPT or Codex client secret store. Raw tokens are not stored by the server.
6. Back up the persistent database and registry with the operator command from #19, for example:

```sh
docker compose -f deploy/board/compose.yml exec handoff \
  node dist/src/cli.js backup /var/lib/agent-handoff/backups/handoff.sqlite \
  --db /var/lib/agent-handoff/handoffs.sqlite \
  --registry /etc/agent-handoff/agents.yaml
```

Keep dated copies outside the container volume too. Follow `docs/RECOVERY.md`; restore only while every HTTP and stdio server is stopped, and reconcile policy changes made after the snapshot.

The Nginx proxy terminates TLS, restricts the public surface to `/mcp`, `/healthz` and `/readyz`, and applies a per-IP request limit. The application also retains its own bearer-aware rate limit. Do not set `HANDOFF_MCP_TRUST_PROXY_HOPS` higher than the number of trusted proxy hops.

## Authentication and privacy

The demo reuses the engine's bearer-token identity registry for one tenant. Each identity has explicit send and receive authorisation, an expiry and a disclosure ceiling. OAuth would add browser consent, refresh-token lifecycle, client registration and an operator-managed identity mapping. Multi-tenant hosting would add tenant isolation, tenant-aware policy and billing boundaries. Neither is built here. Whether either is wanted is an open owner question.

Do not place passwords, OAuth tokens, personal data, private vault links or production handoffs in the demo fixture. Handoff content is untrusted input. Astraeus can provide implementation help through the link in `plugin.json`; pricing is not discussed or sold in chat.
