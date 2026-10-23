# v0.1.0 publish checklist (owner only)

For Alexei. Every step below is an owner action: agents do not merge, tag,
publish or submit. Run the steps in order and stop at the first one whose
output does not match. Total time is about 75 minutes, most of it waiting
for CI. Control plane gate: **6afcbe2d** (npm trusted publishing, then tag
v0.1.0). **#60 (Postgres store) stays held until the tag is pushed.**

Run the commands in Git Bash from a clean checkout of the repository.

| # | Step | Time | Command | Expected output |
| --- | --- | --- | --- | --- |
| 1 | Merge #68 (Zod 4.6.7, `expires_at` needs seconds) | 3 min | `gh pr merge 68 --squash` | `Squashed and merged pull request #68`. The `ci-ok` check on main goes green. |
| 2 | Close Dependabot #64, superseded by #68 | 1 min | `gh pr close 64 --comment "Superseded by #68"` | `Closed pull request #64` |
| 3 | Bring this PR up to date and date-stamp the changelog | 5 min + 10 min CI | see block A | `ci-ok` green on this PR |
| 4 | Merge this PR | 2 min | `gh pr merge PRNUM --squash` | `Squashed and merged pull request #PRNUM` |
| 5 | Register the npm trusted publisher (gate 6afcbe2d) | 10 min | npmjs.com, see block B | Package settings list GitHub Actions, `SarutobiSasuke8/agent-handoff-mcp`, `release.yml`, environment blank |
| 6 | Hosted release dry run on main | 2 min + 8 min CI | `gh workflow run release.yml --ref main -f dry_run=true` then `gh run watch` | Every step green; the last log line is `+ @sarutobi-sasuke/agent-handoff-mcp@0.1.0` and nothing is published |
| 7 | Tag v0.1.0 on the commit from step 4 | 3 min | see block C | `* [new tag] v0.1.0 -> v0.1.0` |
| 8 | Watch the publish run | 8 min | `gh run list --workflow release.yml --limit 1` then `gh run watch` | `Publish to npm with provenance` succeeds |
| 9 | Create the GitHub Release | 3 min | see block D | Release page at `.../releases/tag/v0.1.0` with the notes |
| 10 | Publish to the MCP Registry | 10 min | see block E | `mcp-publisher publish` reports success |
| 11 | Verify npm, provenance and the registry | 10 min | see block F | Version `0.1.0` on npm, signatures verified, one registry entry |
| 12 | Close out | 3 min | Control plane | Approve or reply on gate 6afcbe2d; release the #60 hold |

## A. Update this PR and set the release date (step 3)

```bash
git fetch origin
gh pr checkout PRNUM
git merge origin/main -m "Merge main after #68"
# Replace YYYY-MM-DD with the day you will tag.
sed -i 's/^## \[0.1.0\] - unreleased/## [0.1.0] - YYYY-MM-DD/' CHANGELOG.md
git commit -am "Date-stamp CHANGELOG for v0.1.0"
git push
gh pr checks PRNUM --watch
```

Optional in the same commit: the `0.1.0 is the first release candidate`
paragraph in `CHANGELOG.md` says nothing is published yet. Reword it if you
want the published changelog to read as final.

Direct pushes to `main` are refused (ruleset `main-requires-ci`), so the date
has to land through this PR.

## B. npm trusted publisher (step 5)

1. Sign in at npmjs.com with 2FA.
2. Open `@sarutobi-sasuke/agent-handoff-mcp`, Settings, Trusted publishing.
3. Add GitHub Actions: organisation or user `SarutobiSasuke8`, repository
   `agent-handoff-mcp`, workflow `release.yml`, environment **blank**.

`release.yml` has no GitHub `environment:`, so there is no deployment approval
to click in GitHub. This npm registration is the only approval the publish
needs. **Stop here** if npm will not let you add a trusted publisher before
the package exists (it returned 404 on 2026-10-23). Do not add an npm token to
GitHub; ask an agent to look at the options instead.

## C. Tag (step 7)

```bash
git fetch origin
git switch main
git pull --ff-only
git log --oneline -3        # top commit is this PR's squash, #68 below it
TAG_SHA=$(git rev-parse HEAD)
node -p "require('./package.json').version"   # 0.1.0
git tag -a v0.1.0 "$TAG_SHA" -m "v0.1.0"
git push origin v0.1.0
```

The tag push starts `release.yml`. It checks the tag matches `package.json`,
runs every gate again and publishes with provenance.

## D. GitHub Release (step 9)

```bash
gh release create v0.1.0 --verify-tag --title "v0.1.0" --notes-file docs/release/v0.1.0-notes.md
RUN_ID=$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run download "$RUN_ID" -n release-evidence -D release-evidence-v0.1.0
gh release upload v0.1.0 release-evidence-v0.1.0/*
```


## E. MCP Registry (step 10)

The release workflow does not publish to the registry. `server.json` and the
`mcpName` field in `package.json` are already in place and checked by CI.

```bash
# Install mcp-publisher from https://github.com/modelcontextprotocol/registry/releases
mcp-publisher login github      # browser device-code sign-in as SarutobiSasuke8
mcp-publisher publish           # run from the repo root on the v0.1.0 tag
```

npm must already show 0.1.0 (step 8): the registry checks that the npm
package's `mcpName` matches `io.github.SarutobiSasuke8/agent-handoff-mcp`.

## F. Verify (step 11)

```bash
npm view @sarutobi-sasuke/agent-handoff-mcp@0.1.0 version   # 0.1.0
node scripts/cold-install-check.mjs @sarutobi-sasuke/agent-handoff-mcp 0.1.0
mkdir -p /tmp/ahm-sig && cd /tmp/ahm-sig && npm init -y >/dev/null && npm install @sarutobi-sasuke/agent-handoff-mcp@0.1.0 && npm audit signatures
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.SarutobiSasuke8/agent-handoff-mcp"
```

Expected: `cold-install-check` prints a passing table to paste into a
`docs/RELEASE_EVIDENCE_<date>.md`; `npm audit signatures` reports verified
registry signatures and attestations; the registry query returns
`"count":1` with version `0.1.0`. The npm package page shows a provenance
badge linking to the workflow run.

## Notes

- Gate 6afcbe2d also covers `obsidian-github-mcp`. If you only release this
  package now, reply on the gate rather than approving it.
- Open PRs #67, #59 and #49 are not needed for v0.1.0. If you merge any of
  them before step 7, rerun step 6 first.
- Local dry run: `npm publish --dry-run --ignore-scripts`. A plain
  `npm publish --dry-run` fails locally by design (see `RELEASING.md`).
