# Agent Handoff Board: ChatGPT and Codex plugin

Agent Handoff Board is the directory packaging of Agent Handoff MCP for teams running several coding agents. It gives agents and the people who supervise them one governed place to create, accept, review and close bounded handoffs. Every transition is attributed to an identity and kept as an append-only event. Who may send to whom, and how sensitive the content may be, is set by the operator's registry, not by the chat.

This is governed AgentOps, not another chat wrapper. The board coordinates work. It does not run agents, open references, read files or message anyone outside the board.

Teams that want help designing and running governed agent systems on top of it can talk to [Astraeus Business Solutions](https://astraeus.ie) about implementation. Nothing is sold inside ChatGPT or Codex, and the plugin carries no pricing.

## Contents

| Item | Where |
|---|---|
| Plugin manifest, MCP config, skills | [`plugins/agent-handoff-board/`](../../plugins/agent-handoff-board) |
| Local validator | `npm run check:plugin` (add `-- --submission` for strict mode) |
| Hosted single-tenant demo recipe | [hosting.md](hosting.md), [`Dockerfile`](../../Dockerfile), [`deploy/board/compose.yaml`](../../deploy/board/compose.yaml) |
| Demo workspace and seed script | [demo-workspace.md](demo-workspace.md), `scripts/board-demo-seed.mjs` |
| Test cases (5 positive, 3 negative) and runner | [test-cases.md](test-cases.md), `scripts/board-test-cases.mjs` |
| Walkthrough | [walkthrough.md](walkthrough.md) |
| Privacy policy draft | [privacy.md](privacy.md) |
| Terms draft | [terms.md](terms.md) |

## Verb mapping

The plugin adds no tools and changes no protocol. Its four skills map the board's verbs onto the six existing MCP tools.

| Verb | Skill | Tools |
|---|---|---|
| Create | `create-handoff` | `handoff_whoami`, `handoff_send` |
| Accept | `accept-handoff` | `handoff_get`, `handoff_acknowledge` |
| Review | `review-handoffs` | `handoff_inbox`, `handoff_get` |
| Close | `close-handoff` | `handoff_get`, `handoff_update_status` (`completed`, `blocked`, or `cancelled` by the sender while queued) |

`npm run check:plugin` fails if a skill names a tool the server does not register, if a verb skill stops using its mapped tool, if pricing or checkout copy appears, or if `mcp.json` carries a credential-like field.

## Package format

Follows OpenAI's plugin documentation at https://developers.openai.com/plugins/build/plugins as applied in JobScout Discover (jobscout-mcp #14, PR #15): a root `plugin.json` with an `extensions.com.openai` section, a root `mcp.json` using `streamable-http`, and `skills/<name>/SKILL.md`. OpenAI documents no standalone validator command, so `scripts/check-plugin.mjs` checks the structural rules. Passing it means the package is well formed. It does not mean the portal will accept it.

## Authentication

The hosted demo is a single tenant and reuses the server's existing bearer-token identities: each identity in the registry has an expiring token stored only as a SHA-256 digest. A client sends `Authorization: Bearer <token>` on every request. No token is stored in the plugin package.

- **Codex and other MCP clients** that let the user configure a bearer token for a Streamable HTTP server can use the demo today.
- **ChatGPT directory listing** is expected to need an OAuth sign-in flow rather than a pasted static token. That is not built. See the open questions.

## Open questions for Alexei

1. **OAuth for directory review.** Is a single-tenant demo with bearer tokens enough for review, or does submission need OAuth sign-in first? OAuth would add an authorisation server (or a hosted identity provider), token exchange mapping a signed-in user to a registry identity, consent and revocation screens, and refresh-token handling. The server's `requireBearerAuth` verifier would need a second verifier for OAuth access tokens. None of this is built.
2. **Multi-tenant hosting.** Today one registry and one SQLite file form one workspace. Multi-tenant would add per-tenant registries and databases (or a tenant column and tenant-scoped queries), tenant-aware token verification, per-tenant rate limits and backups, and self-service provisioning. That is a product decision as much as a code change.
3. **Annotate verb.** The brief lists an "annotate" (comment) verb. The server has no such tool and the protocol is frozen before release, so it is not built. Should a comment event be added after the publish gate?
4. **Host name.** `handoff.astraeus.ie` is a placeholder in `plugin.json`, `mcp.json` and the compose `.env.example`. DNS and deployment are the operator's steps.

## Remaining gaps before submission (not faked)

1. DNS for the public host, a deployed instance and domain verification.
2. Privacy and terms pages published at `https://handoff.astraeus.ie/privacy` and `/terms` (the handoff server only serves `/mcp`, `/healthz` and `/readyz`; publish them on the Astraeus site or a static host and route them), with legal review.
3. `.app.json` with the `plugin_asdk_app_id` issued by the submission portal.
4. Icon, logo and screenshots as PNG in `plugins/agent-handoff-board/assets/`. Screenshots need a live instance.
5. A reviewer demo token entered only in the portal's private field.
6. The OAuth decision above.
7. Submission through the portal, which only the operator can do.
