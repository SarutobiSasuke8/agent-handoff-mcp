# Runtime pins

This file lists every floating runtime or supply-chain reference in this repository and the exact value each one would be pinned to. It is produced by `scripts/pin-check.mjs`, which runs as the `pin-check` job in CI.

Resolved on 2026-10-16. Nothing in this file has been applied yet: the Dockerfile, the compose file and `engines.node` are unchanged.

## Status

- **Node version and Docker base image:** pending gate d48fb4c7. Do not change them until that gate is approved.
- **Compose proxy image:** proposed, same gate as the base image because it is part of the deployed runtime.
- **Action references:** none floating. Every `uses:` line is already pinned to a full commit SHA.
- **Git dependencies:** none floating. `@sarutobi-sasuke/mcp-eval-harness` is already pinned to commit `077c74a60ccd6d9061e35f882ffd3db5f5d17052`.

## Floating references and proposed pins

| Kind | Location | Current | Proposed pin | Status |
| --- | --- | --- | --- | --- |
| Dockerfile FROM | `Dockerfile:3` (build stage) | `node:22-slim` | `node:22.23.3-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392` | pending gate d48fb4c7 |
| Dockerfile FROM | `Dockerfile:11` (runtime stage) | `node:22-slim` | `node:22.23.3-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392` | pending gate d48fb4c7 |
| engines.node | `package.json` | `>=22.13` | `22.23.3` (current Node 22 LTS, "Jod", released 2026-09-23) | pending gate d48fb4c7 |
| Compose image | `deploy/board/compose.yaml:20` | `traefik:v3.3` | `traefik:v3.3.7@sha256:2cd5cc75530c8d07ae0587c743d23eb30cae2436d07017a5ff78498b1a43d09f` | pending gate d48fb4c7 |

The `agent-handoff-mcp:board` image in the same compose file is built locally from this repository's Dockerfile, so the script does not report it. Pinning the Dockerfile base pins it.

## How the values were resolved

- **Docker digests:** `docker buildx imagetools inspect <image>`, cross-checked with the Docker Hub registry API (`HEAD /v2/library/<repo>/manifests/<tag>`). Values are multi-platform image index digests. `node:22.23.3-slim` resolves to the same digest as `node:22-slim` today, and `traefik:v3.3.7` to the same digest as `traefik:v3.3`.
- **Node version:** the newest `v22.*` entry in <https://nodejs.org/dist/index.json> is `v22.23.3` (LTS "Jod", 2026-09-23).
- **Already-pinned actions (for reference):** `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` is tag `v7.0.1`, `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1` is tag `v7.1.0`, and `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9` is tag `v7.0.2`. All three were confirmed with `gh api repos/actions/<repo>/git/ref/tags/<tag>`.

## Notes

- Digests for floating tags such as `node:22-slim` change with every upstream rebuild. Re-resolve them on the day the pin is applied and update this file.
- `engines.node` is a published compatibility range for npm users as well as a runtime pin. `22.13` is the documented minimum for `node:sqlite`. When gate d48fb4c7 is decided, pin the runtime in the Dockerfile and CI, and decide separately whether the published range should stay a range.
- The workflow `node-version` values also float to the newest patch release: the `ci.yml` matrix and coverage job (`22.x`, `24.x`), `inspector.yml` (`22.x`), `mcp-eval.yml` (`22`) and `release.yml` (`24.x`). Rechecked on 2026-10-21. The pin-check script does not report them; they are part of the same gate.
- The `pin-check` job's own checkout step is pinned to a SHA, so it adds no new floating reference.

## Turning the check into a gate

`node scripts/pin-check.mjs` reports and exits 0. `node scripts/pin-check.mjs --strict` (or `PIN_CHECK_STRICT=1`) emits errors and exits 1 when any floating reference remains. Switch the CI step to `--strict` once the pins above are applied.
