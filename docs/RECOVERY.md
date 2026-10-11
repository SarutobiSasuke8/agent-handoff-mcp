# Backup and recovery

These are operator CLI commands, outside the 6 MCP tools. Use Node 22.13 or newer. Backups contain private handoff content and registry token **digests**, never client-held raw tokens. Keep them outside the source repository, with access restricted to the operator. File mode is 0600 where supported; on Windows, use a directory with an appropriate NTFS ACL.

## Back up while serving

```sh
agent-handoff-mcp backup ./backups/handoff-2026-10-08.sqlite --db ./data/handoffs.sqlite --registry ./config/agents.yaml
```

`--db` and `--registry` default to `HANDOFF_MCP_DB` and `HANDOFF_MCP_REGISTRY`, or the usual local paths. Supply a new output filename each time. Existing output files are never overwritten.

SQLite `VACUUM INTO` takes a consistent snapshot including committed WAL contents, without stopping HTTP or stdio. It does not copy the live database file directly. The backup is a self-contained SQLite file with recovery metadata containing the validated registry and its SHA-256 digest. Integrity, foreign keys, runtime columns and the idempotency constraint are checked before the output is accepted. Recovery refuses unexpected tables, views and triggers. The supported backup limit is 128 MiB.

Pause registry provisioning changes during the command. The registry is checked before and after the database snapshot; an observed change aborts the backup. These are separate storage systems, so there is no joint database/registry transaction. Server handoff traffic can continue. The brief startup/recovery guard prevents another CLI recovery or server startup racing the snapshot; it does not block handoff requests to running servers.

Choose a cadence from the amount of state you can afford to lose: daily for light use, more often for active queues, and before maintenance. Keep several dated copies and a separately protected copy off the machine. Verify a checksum through your backup system and practise a fresh-directory restore periodically. SHA-256 and SQLite integrity detect corruption; they do not authenticate a backup supplied by an untrusted party.

## Restore into a fresh directory

1. Stop every HTTP and stdio process using the destination database **or registry**. Do not restore a registry used by another live server.
2. Use a trusted backup and new destination files:

```sh
agent-handoff-mcp restore ./backups/handoff-2026-10-08.sqlite --db ./recovered/handoffs.sqlite --registry ./recovered/agents.yaml
```

3. Point `HANDOFF_MCP_DB` and `HANDOFF_MCP_REGISTRY` at those 2 files. Restart the server and check readiness, an allowed handoff read and a denied access case before returning clients to service.

The snapshot restores handoffs, lifecycle events, idempotency keys and payload hashes, plus the saved registry policy, disabled identities, expiry dates and token digest bindings. Raw tokens held by clients, environment variables, host configuration, network settings and changes after the snapshot are not restored. A rotation or revocation **after** backup is also not restored: reconcile policy against the latest operator record before restarting. A rotation or revocation already in the snapshot survives recovery.

## Replace stopped state

Replacing either existing destination requires `--force`. That flag does not bypass live-server detection or validation:

```sh
agent-handoff-mcp restore ./backups/handoff-2026-10-08.sqlite --db ./data/handoffs.sqlite --registry ./config/agents.yaml --force
```

Replaced files are retained beside the destination as `<path>.<restore-id>.pre-restore`. Keep them until verification completes. Corrupt or truncated input is rejected before any destination replacement. A WAL or SHM sidecar also blocks replacement, including one left by an older server without recovery leases. Stop that instance and let SQLite close/checkpoint it before retrying; do not discard its WAL.

Every current HTTP/stdio runtime registers process leases beside both files (`.handoff-servers/`). Multiple servers remain supported. Restore refuses any live PID or uncertain lease; a lease whose process has exited is ignored. A reused PID can conservatively block restore. These are local-machine guards, not distributed locks: do not put this database on a shared filesystem or run uncoordinated external SQLite writers. Stop pre-upgrade instances as well.

## Interrupted recovery

Database and registry installation is not a single filesystem transaction. Before replacement, the CLI writes `.handoff-restore-pending` markers beside both files. Startup and further recovery refuse either marker, so a partial install cannot serve mismatched state and policy. A crashed command can also leave a `.handoff-guard/` directory.

Stop all relevant processes, inspect the markers and retained `.pre-restore` files, and restore a known pair into a **fresh directory**. Point the server at that verified pair. Remove stale guards/markers from the old destination only after establishing that no command is running and both files form a verified pair. Do not automate that cleanup or blindly retry `--force`.

## Local release evidence

From a source checkout:

```sh
npm run release:dry-run
```

The command runs `npm ci`, `npm run check`, `npm run test:e2e`, the tarball allowlist verifier, `npm sbom --sbom-format=spdx --omit=dev` and `npm pack`. It uses Node's SHA-256 implementation to produce the same checksum format as `sha256sum`. Evidence goes to a dated directory under gitignored `release-evidence/`: step logs, the tarball, `checksums.sha256`, `sbom.spdx.json` and `summary.json` with Node/npm versions, source revision and dirty state. A failed step stops the command.

This produces local evidence. It does not create a tag, release, trusted-publisher configuration or hosted provenance, and performs no package publication. Review the exact clean candidate and remaining owner gates in the release evidence notes before the hosted release.

SQLite snapshot behaviour: [VACUUM INTO documentation](https://www.sqlite.org/lang_vacuum.html#vacuum_with_an_into_clause).
