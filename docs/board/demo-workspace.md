# Demo workspace

`scripts/board-demo-seed.mjs` creates the single-tenant demo workspace on a fresh volume. It refuses to run if the registry or database already exists.

## Identities (synthetic)

| Identity | Stands for | Sends to | Receives from | Disclosure ceiling |
|---|---|---|---|---|
| `demo-operator` | the human lead | planner, coder, reviewer | planner, coder, reviewer | `restricted` |
| `demo-planner` | a planning agent | operator, coder | operator | `internal` |
| `demo-coder` | a coding agent | operator, reviewer | operator, planner, reviewer | `internal` |
| `demo-reviewer` | a review agent | operator, coder | operator, coder | `public-safe` |

Each identity gets an expiring bearer token (30 days by default, `--expires` to change). Only SHA-256 digests are written to the registry. The raw tokens are printed once, or written once to `--tokens-out <file>` with mode 0600. For directory review, hand over one token (normally `demo-operator`) only through the portal's private field.

## Seeded handoffs

Created through the normal service layer, so every record passed the same policy checks as a real call.

| Status | From | To | Title |
|---|---|---|---|
| accepted | operator | planner | Plan the v0.2 release checklist |
| completed | planner | coder | Fix the flaky login end-to-end test (follow-up of the plan) |
| queued | coder | reviewer | Review the rate limit headers change (`public-safe`) |
| blocked | operator | coder | Rotate the staging service credentials (`urgent`; needs a maintenance window) |
| queued | operator | reviewer | Draft public release notes (`public-safe`, `low`) |

All content is synthetic. References such as `repo:demo/agent-service` are inert labels.

## Running it

In the container (see [hosting.md](hosting.md)):

```bash
docker compose -f deploy/board/compose.yaml run --rm --no-deps handoff node scripts/board-demo-seed.mjs
```

From a source checkout, after `npm ci && npm run build`:

```bash
HANDOFF_MCP_DB=./demo/handoffs.sqlite HANDOFF_MCP_REGISTRY=./demo/agents.yaml \
  node scripts/board-demo-seed.mjs --tokens-out ./demo/tokens.json
```

Keep `./demo/` out of git. The runner in [test-cases.md](test-cases.md) reads that tokens file.
