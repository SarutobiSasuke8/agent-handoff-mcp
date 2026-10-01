# Release evidence, 2026-10-01

Candidate assessed: `3156e28297d2e7179ca0079ed350cc91056f3613`, package version 0.1.0, before publication. Environment: Windows, Node 22.22.1 and npm 11.19.0. This is a maintainer validation record, not an independent security audit.

| Check | Result |
|---|---|
| `npm run check` | Passed: type check, lint and 33 unit tests |
| `npm run test:e2e` | Passed: 7 end-to-end tests |
| Clean tarball installation | Passed inside the end-to-end suite from a disposable operator directory |
| HTTP and stdio | Both served the installed artifact and passed revocation parity |
| Policy and persistence | Strict parsing, live revocation, invalid-policy handling, token rotation and restart persistence passed |

The unit tests also cover semantic idempotency conflicts and actor-specific transitions. The end-to-end tests use the MCP SDK client, not actual Claude and Codex application sessions. Temporary identities, tokens and databases are test fixtures.

## Release workflow changes

The publisher now runs on Node 24 so its npm CLI supports trusted publishing. A manual dispatch must select a matching version tag; dispatching from a branch no longer bypasses the tag/version check. Runtime support remains Node 22.13 or newer.

The sweep also refreshes 4 locked dependencies within their existing version constraints. The production dependency audit initially reported 3 moderate advisories; after the refresh, npm reports 0 vulnerabilities. Unit and packaged-transport checks are repeated against the updated lockfile before this change is handed off.

## Remaining gate

- Configure and verify the package's npm trusted publisher.
- Review the release tag and run the hosted release workflow on the exact candidate.
- Retain the generated artifact checksum, SBOM and hosted run links.
- Cold-install the published package.
- Record actual cross-client workflow evidence and operational recovery/backup proof before a stable claim.

The source is materially further along than the original August audit. These results substantiate specific regressions; they do not close every historical finding or establish unrestricted fleet readiness.
