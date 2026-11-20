# Skills over MCP: design spike

Status: review draft, no release. Observation date: 26 October 2026.

## Version and API

The [official 2.4.0 release](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.4.0) adds SEP-2640 Skills through the split server, client and core packages. The older `@modelcontextprotocol/sdk` package is 1.x, not 2.4.0. This repository already uses the split packages; the spike pins server and test client to 2.4.0.

The [server guide](https://ts.sdk.modelcontextprotocol.io/v2/servers/skills.html) documents folder loading and catalog attachment. The attachment API is experimental. The [client guide](https://ts.sdk.modelcontextprotocol.io/v2/clients/skills.html) documents discovery and verified reads. Extension support spans protocol versions 2025-11-25 and 2026-07-28; the latter adds caching metadata. No guarantee of host-product support follows from protocol compatibility.

## Opt-in attachment proof

Production HTTP and stdio bootstraps remain unchanged. The test attaches a static catalog to the existing factory before connecting it:

```ts
import { loadSkills } from "@modelcontextprotocol/server/ext/skills/node";

const catalog = await loadSkills(skillDirectory, { strict: true });
const server = createHandoffMcpServer(service, authenticatedAgentId);
catalog.attach(server);
// Connect the existing transport afterwards.
```

`skillDirectory` must be the operator-selected package `skills/` folder, never a client-supplied path. It contains only the two public how-to documents in this PR. No handoff data, registry, token or database is part of that catalog. This proof does not add an arbitrary filesystem tool or enable runtime skill discovery in deployed servers.

## Content and packaging

The package file list includes `skills/`. The two workflows cover task creation and review/closure, using only the existing six tools. The existing board-plugin skills remain separate and unchanged. They are a different installation surface, not evidence of Skills protocol support.

Run the pack verifier and inspect the dry-run file list. A packed release must contain both new SKILL.md files and this design note. Package version remains 0.1.0; no npm or MCP Registry write is part of the spike.

## Clients

| Client surface | Evidence in this spike | Decision |
|---|---|---|
| SDK 2.4.0 SkillsClient | In-memory list/get/read with digest verification on 2025-11-25 | Verified by tests |
| Claude native MCP connection | No native host pickup exercised | Unverified; retain the existing plugin/manual installation route |
| ChatGPT native connector | No native host pickup exercised | Unverified; do not advertise auto-installation |
| Codex native MCP connection | No native host pickup exercised | Unverified; manual skill installation remains separate |

Before enabling a host, record its version, advertised extension, listed catalog, verified file read and observed workflow use. A successful tools/list response alone is insufficient. The plain in-memory transport uses the legacy initialize handshake and refuses a 2026-07-28-only client. A modern HTTP negotiation test remains open; the SDK's documented modern compatibility is not claimed as locally verified.

## Evaluation and future packs

The production tool list and lifecycle stay unchanged. The existing mcp-eval goldens must pass without updates. The new extension test separately checks the catalog, verified reads, unchanged tool names and failure on a missing skill. Native host evaluations remain open.

Future vertical packs could supply a separate, operator-selected static catalog. This is a packaging hypothesis only. Pricing, billing, entitlement checks, remote downloads and private-data inclusion are outside this PR and need their own design and authorisation. Do not infer an entitlement or add a paid path from a skill document.

## Review gate

Keep this PR draft. Review the content, package contents, test evidence and native-client gaps before considering runtime attachment. No auth, scopes, registry, release, package version, scheduling or production bootstrap changes are included.
