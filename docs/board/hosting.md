# Hosted single-tenant demo: deployment recipe

This recipe runs one Agent Handoff MCP workspace behind a TLS reverse proxy, for the Agent Handoff Board demo. Nothing here has been deployed. DNS for the public host is the operator's step.

## What it runs

| Service | Image | Role |
|---|---|---|
| `proxy` | `traefik:v3.3` | TLS termination with Let's Encrypt (TLS-ALPN challenge), HTTP to HTTPS redirect, per-IP rate limit, request body cap. Routes only `/mcp`, `/healthz` and `/readyz` for the public host. |
| `handoff` | built from the repository `Dockerfile` | The Streamable HTTP server, as the unprivileged `node` user, with the registry and SQLite database on the `handoff-state` volume. No published ports. |
| `backup` | same image, `backup` profile | One-shot snapshot of the live database plus a registry copy to the `handoff-backups` volume. |

Files: [`Dockerfile`](../../Dockerfile), [`.dockerignore`](../../.dockerignore), [`deploy/board/compose.yaml`](../../deploy/board/compose.yaml), [`deploy/board/.env.example`](../../deploy/board/.env.example).

## Prerequisites

- A Linux host with Docker Engine and the Compose plugin, ports 80 and 443 reachable from the internet.
- A DNS `A` or `AAAA` record for the public host (placeholder `handoff.astraeus.ie`) pointing at that host.

## Steps

From a checkout of this repository on the host:

```bash
cp deploy/board/.env.example deploy/board/.env
# Edit deploy/board/.env: HANDOFF_PUBLIC_HOST and ACME_EMAIL at least.

docker compose -f deploy/board/compose.yaml build

# Seed the demo workspace on the fresh volume BEFORE starting the server.
# The server refuses to start without a valid registry.
docker compose -f deploy/board/compose.yaml run --rm --no-deps handoff \
  node scripts/board-demo-seed.mjs
# The four raw demo tokens are printed once. Put them in a secret store now.

docker compose -f deploy/board/compose.yaml up -d
docker compose -f deploy/board/compose.yaml ps        # handoff should become "healthy"
curl -fsS https://handoff.astraeus.ie/readyz
```

The image healthcheck calls `/healthz` and `/readyz` inside the container and is healthy only when both return 200. `/readyz` returns 503 if the registry later fails validation (for example after a bad manual edit); the server keeps serving the last valid policy snapshot meanwhile.

## Environment

The image sets `HANDOFF_MCP_HOST=0.0.0.0`, `HANDOFF_MCP_PORT=3220`, `HANDOFF_MCP_DB=/var/lib/agent-handoff/handoffs.sqlite` and `HANDOFF_MCP_REGISTRY=/var/lib/agent-handoff/agents.yaml`. Compose adds:

| Variable | Value | Why |
|---|---|---|
| `HANDOFF_MCP_ALLOWED_HOSTS` | public host, `localhost`, `127.0.0.1` | DNS rebinding protection: any other `Host` header gets 403. `127.0.0.1` keeps the in-container healthcheck working. |
| `HANDOFF_MCP_TRUST_PROXY_HOPS` | `1` | Traefik is one hop, so the in-app limiter keys on the real client address. |
| `HANDOFF_MCP_RATE_LIMIT`, `HANDOFF_MCP_RATE_WINDOW_MS` | 120 per 60 s | In-app limiter on `/mcp`, behind the edge limiter. |
| `PROXY_RATE_AVERAGE`, `PROXY_RATE_BURST` | 60 per minute, burst 20 | Edge per-IP limit in Traefik (`ipStrategy.depth=0`, the direct client address). |

## Token provisioning

Tokens are issued with the existing CLI against the registry on the volume. Raw tokens are printed once and never stored; only SHA-256 digests reach the registry. The server reloads the registry on change, so no restart is needed.

```bash
C="docker compose -f deploy/board/compose.yaml exec handoff node dist/src/cli.js"
$C issue   --registry /var/lib/agent-handoff/agents.yaml --agent demo-reviewer --expires 2026-12-31T00:00:00Z
$C rotate  --registry /var/lib/agent-handoff/agents.yaml --agent demo-reviewer --expires 2026-12-31T00:00:00Z
$C disable --registry /var/lib/agent-handoff/agents.yaml --agent demo-reviewer
$C validate --registry /var/lib/agent-handoff/agents.yaml
```

To add an identity, edit the registry on the volume (it is plain YAML; see `config/agents.example.yaml`), then `issue` and `enable`.

## Backup

```bash
docker compose -f deploy/board/compose.yaml --profile backup run --rm backup
```

`scripts/board-backup.mjs` takes a consistent snapshot with SQLite `VACUUM INTO` while the server keeps running, checks it with `PRAGMA integrity_check`, copies the registry beside it, sets both files to mode 0600, and keeps the newest `HANDOFF_BACKUP_KEEP` pairs (default 14). Schedule it from the host's cron or a systemd timer, and copy the `handoff-backups` volume off the host.

This is an interim script. The guarded `agent-handoff-mcp backup` and `restore` commands from issue #19 are in open PR #20 and not yet on `main`. Once that merges, change the `backup` service's entrypoint to `node dist/src/cli.js backup /var/backups/agent-handoff/handoff-<date>.sqlite` and use its `restore` for recovery, which also validates the registry and refuses to restore under a live server.

Until then, to restore: stop the stack, copy a snapshot pair into a fresh `handoff-state` volume as `handoffs.sqlite` and `agents.yaml` (owned by uid 1000, mode 0600), and start again. Reconcile any token rotation or revocation made after the snapshot before restarting.

## Hardening notes

- Traefik reads container labels through the Docker socket, mounted read-only. On a stricter host, front it with a socket proxy or move the routing into Traefik's file provider.
- Traefik access logs are off because they record client IP addresses. If you turn them on, update the privacy policy's retention section.
- The handoff server is not published on a host port. Keep it that way: TLS, rate limiting and the body cap all live at the proxy.
- Back up the `letsencrypt` volume as well, or certificates will be re-issued on a fresh host.

## What was and was not verified

See the PR that added this recipe for the exact evidence. In short: `docker compose config` was validated locally, and the seed, healthcheck command, 8 test cases and backup were run against the server started directly with Node on a fresh SQLite file. `docker build`, the container healthcheck and the Traefik TLS and rate-limit path have not been run, because no Docker daemon was available on the build machine.
