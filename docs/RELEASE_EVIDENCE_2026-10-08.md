# Local release and recovery evidence, 2026-10-08

Assessed source: `40ca1c4c00754f2cb7f0fce422640aaf5ad14c2c`, clean worktree, package 0.1.0. Local environment: Windows, Node 22.22.1, npm 11.19.0. This note is added after the assessed run, so the recorded checksum identifies that source candidate's tarball, before this evidence note was included in the package.

`npm run release:dry-run` completed at 09:43:59 UTC. Evidence is retained locally under gitignored `release-evidence/2026-10-08T09-40-55-831Z/`.

| Check | Result |
|---|---|
| `npm ci` | Passed |
| `npm run check` | Typecheck and lint passed; 33 unit/integration tests passed |
| `npm run test:e2e` | 10 passed, including clean tarball installation and 3 new recovery scenarios |
| `node scripts/verify-pack.mjs` | 70 files; all required present, none forbidden |
| `npm sbom --sbom-format=spdx --omit=dev` | SPDX JSON generated; 76 packages |
| `npm pack` | `sarutobi-sasuke-agent-handoff-mcp-0.1.0.tgz` generated |
| SHA-256 | `e72ecd8078223ecda786eb58b7cc4a815c9600cfcb3fe96bf39521489d635586` |

The recovery scenarios drive the CLI and real MCP clients. They back up an active WAL server, restore into fresh files, compare handoffs and event history, check identical idempotent retries and conflicting payloads, and confirm that rotated credentials and a revoked identity remain denied. They also check running HTTP/stdio servers and shared registry leases, corrupt/truncated files, tampered registry metadata, an unexpected trigger, retained previous files during stopped `--force` replacement, residual WAL sidecars and interrupted-restore startup refusal. Tests use temporary synthetic identities and databases; no live operator state was backed up or restored.

The backup is a single SQLite snapshot with validated registry metadata. See [Recovery](RECOVERY.md) for separate-store consistency, local lease limits, fresh-directory recovery and reconciliation of revocations made after a snapshot.

## Remaining release work

The hosted CI matrix and release provenance were not exercised. This run covers Windows and Node 22.22.1; it does not establish every supported Node/OS combination or filesystem power-loss behaviour. Configure the trusted publisher, review the exact release tag/candidate, run the hosted workflow and cold-install the published package through the owner process.

The current lockfile also has an existing production audit finding in `proxy-addr`: [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), critical, fixed in 2.0.8. `npm audit --omit=dev --json` reported 1 critical production finding. The advisory concerns misconfigured trusted IPv6 subnets; this server's default disables proxy trust and its configuration exposes a hop count, so the audit finding alone is not evidence that the default server is exploitable. Dependency remediation remains separate from recovery issue #19 and should be reviewed before publication.

Nothing was published, tagged, released, deployed or merged. No workflow files were changed.
