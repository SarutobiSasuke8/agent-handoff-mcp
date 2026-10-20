# Releasing

Releases publish `@sarutobi-sasuke/agent-handoff-mcp` to npm from
`.github/workflows/release.yml`, using npm trusted publishing (OIDC) with
provenance. No npm token is stored in GitHub. Publishing is an owner action.

## One-time setup

On npmjs.com, register this repository and the `release.yml` workflow as the
trusted publisher for `@sarutobi-sasuke/agent-handoff-mcp`.

## Dry run (any time, publishes nothing)

Actions, Release, Run workflow. Pick any branch or tag and leave **dry_run**
ticked. The run does `npm ci`, `npm run check`, the e2e suite, the tarball
allowlist check, the SBOM, `npm pack` with checksums, and
`npm publish --dry-run --provenance`. It skips the tag/version check so it can
run from a branch. The evidence is uploaded as the `release-evidence` artefact.

For a local equivalent without GitHub, run `npm run release:dry-run`
(see `docs/RECOVERY.md`).

## How to tag v0.1.0

1. Confirm `package.json` says `0.1.0` and the `[0.1.0]` section of
   `CHANGELOG.md` is final. Replace `unreleased` with the date.
2. Run a dry run on `main` and check it is green.
3. Tag and push from an up-to-date `main`:

   ```bash
   git checkout main && git pull --ff-only
   git tag -a v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```

4. The tag push starts the Release workflow, which checks that the tag matches
   `package.json` and publishes with provenance.
5. Cold-install the published package with `node scripts/cold-install-check.mjs`
   and record the result.

A manual dispatch with dry_run unticked publishes only from a version tag; a
branch dispatch with dry_run unticked fails at the tag check.
