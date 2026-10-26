# Postgres store adapter (design note and experimental spike)

Status: **experimental**. SQLite stays the default and the only supported
store for production. The Postgres adapter exists so that several server
hosts can share one handoff store. It is off unless `HANDOFF_STORE=postgres`
is set.

Roadmap: `md-83ad20e6b1` ("Postgres store adapter for multi-host
deployments"). Also answers the multi-host question in issue #17.

## Why

One SQLite file serves one host. Two machines cannot safely share it: SQLite
locking over network filesystems is unreliable, and the recovery guard in
`recovery-lock.ts` is a local-file lease. Multi-host use (for example an HTTP
server on two machines, or a stdio server on a laptop and an HTTP server on a
VPS, both serving the same agents) needs a store that does its own locking
over the network. Postgres does.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `HANDOFF_STORE` | `sqlite` | `sqlite` or `postgres`. |
| `HANDOFF_PG_URL` | unset | Postgres connection string. Required when `HANDOFF_STORE=postgres`. Treated as a secret: never logged, never echoed in errors. Keep it in the environment or a secret manager, never in the repository. |
| `HANDOFF_MCP_DB` | `./data/handoffs.sqlite` | Ignored when `HANDOFF_STORE=postgres`. |

The `pg` driver is an **optional** dependency. It is loaded with a dynamic
import only when the Postgres store is selected, so SQLite deployments never
load it. If it is missing, startup fails with a message that names it.

The registry (`HANDOFF_MCP_REGISTRY`) is unchanged. It stays a file on each
host. See "Multi-host" for what that means.

## Store interface

`src/store-adapter.ts` defines the boundary that `HandoffService` uses:

```ts
type MaybePromise<T> = T | Promise<T>;

interface HandoffStoreAdapter {
  ready(): MaybePromise<void>;
  create(sender: string, input: CreateHandoffInput, maxDepth: number, notificationSink?: NotificationSink): MaybePromise<Handoff>;
  get(id: string): MaybePromise<Handoff>;
  find(id: string): MaybePromise<Handoff | undefined>;
  inbox(recipient: string, statuses: HandoffStatus[], limit: number): MaybePromise<Handoff[]>;
  events(handoffId: string): MaybePromise<HandoffEvent[]>;
  transition(handoffId: string, actor: string, toStatus: Exclude<HandoffStatus, "queued">, note?: string): MaybePromise<Handoff>;
  close(): MaybePromise<void>;
}
```

Design choices:

- **`MaybePromise` return types.** The SQLite adapter (`HandoffStore`) keeps
  its synchronous API, so existing callers and tests are unchanged. The
  Postgres adapter returns promises. `HandoffService` awaits every call, which
  is correct for both.
- **`ready()`** reports startup errors (connection, migration, a newer schema)
  before the server accepts traffic. `app.ts` and `stdio.ts` await it. For
  SQLite it is a no-op because the constructor already opened and migrated.
- **Shared rules.** `allowedTransition` lives in `store-adapter.ts` and both
  adapters call it. Row mapping (`toHandoff`, `toEvent`) and the payload
  fingerprint (`payloadHash`, `rowPayloadHash`) are exported from `store.ts`
  and reused, so the idempotency and lifecycle rules cannot drift between
  adapters.
- **Same errors.** Both adapters raise the same `DomainError` messages, so MCP
  tool output does not depend on the store.
- **Notifications.** When `HANDOFF_MCP_NOTIFICATION_FILE` is set, the service
  passes its `NotificationSink` to `create`. Both adapters record one
  metadata-only notice after a new handoff commits, none for an idempotent
  replay, and swallow sink errors so a failed notice never fails the send.
- `createStore(config)` in `runtime.ts` picks the adapter.

The interface is the persistence contract only. Authorization, disclosure
ceilings and historical-read denial stay in `HandoffService` and do not change
with the store.

## Migrations

Both adapters use the same **version numbers** and the same
`schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)` table.
Version N means the same logical schema in both stores.
`CURRENT_SCHEMA_VERSION` in `migrations.ts` is the single source of truth.

| Version | SQLite (`migrations.ts`) | Postgres (`migrations-postgres.ts`) |
| --- | --- | --- |
| 1 | base `handoffs`, `handoff_events`, indexes | same tables, plus `handoff_events.seq` identity column |
| 2 | `ALTER TABLE handoffs ADD COLUMN payload_hash TEXT` | same |

How they stay in step:

1. A new migration is added to **both** files with the same version number in
   the same pull request, and `CURRENT_SCHEMA_VERSION` is increased once.
2. `test/store-postgres.test.ts` checks that `POSTGRES_MIGRATIONS` covers
   exactly versions 1 to `CURRENT_SCHEMA_VERSION`. This test needs no
   database, so CI catches a missing Postgres migration even without one.
3. The Postgres runner also refuses to start if its list is out of step.

Postgres runner behaviour:

- One transaction, with `pg_advisory_xact_lock` taken first. Several hosts
  starting at once serialise, and the first one migrates. The others then see
  the recorded versions and do nothing.
- Postgres DDL is transactional, so a failed migration leaves no partial
  schema.
- It refuses a history with gaps, or a version newer than the binary. This is
  the same rule and the same message as SQLite.
- It refuses unversioned handoff tables. No legacy Postgres stores exist, so
  there is nothing to adopt. The SQLite "observed version" adoption path is
  not needed.

Intended dialect differences:

- Timestamps stay ISO-8601 `TEXT`. Values, sort order and the API output are
  identical to SQLite. A later migration can move both stores to a native
  timestamp type.
- `handoff_events.seq` replaces SQLite's implicit `rowid` as the stable
  tie-break when ordering events (`ORDER BY created_at, seq`).

## Concurrency: acknowledge, block, complete, cancel

SQLite serialises all writers with `BEGIN IMMEDIATE`. A transition reads the
row, checks the lifecycle rule, updates it and writes the event under that
single write lock. Postgres has many concurrent writers, so the adapter locks
per row.

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT * FROM handoffs WHERE id = $1 FOR UPDATE;          -- row lock
-- allowedTransition(current, actor, toStatus) in TypeScript
UPDATE handoffs SET status = $1, updated_at = $2
 WHERE id = $3 AND status = $4                             -- conditional on the checked status
RETURNING *;                                               -- rowCount must be 1
INSERT INTO handoff_events (...) VALUES (...);             -- audit row in the same transaction
COMMIT;
```

How this prevents a double claim across hosts. Hosts A and B both call
`handoff_acknowledge` on one queued handoff:

1. A takes the row lock. B's `SELECT ... FOR UPDATE` waits.
2. A checks `queued -> accepted`, updates the row, writes the `accepted`
   event and commits. Its lock is released.
3. B's locked read now returns the committed row with status `accepted`.
   Under READ COMMITTED a `FOR UPDATE` read returns the latest committed
   version of the row. `accepted -> accepted` is not an allowed transition,
   so B fails with the same `may not move 'accepted' to 'accepted'` error that
   SQLite gives. B writes no event.

The conditional `WHERE status = $4` plus the `rowCount === 1` check is a second
guard. It cannot fire while the row lock is held, but if someone weakens the
locking later, a lost update becomes a visible error instead of a silent one.

Why READ COMMITTED and not SERIALIZABLE: the row lock already gives each
handoff a single, ordered history, and READ COMMITTED never raises
serialization failures that the caller would have to retry. SERIALIZABLE
would also be correct, but it needs retry logic for little benefit here.

Timeouts: `lock_timeout` is 5 s, the same as SQLite's `busy_timeout`.
`statement_timeout` is 15 s and `idle_in_transaction_session_timeout` is 30 s,
so a stuck host cannot hold a handoff's lock for long.

Idempotent create across hosts uses the existing `UNIQUE(sender,
idempotency_key)` constraint:

```sql
INSERT INTO handoffs (...) VALUES (...)
ON CONFLICT (sender, idempotency_key) DO NOTHING
RETURNING *;
```

If no row comes back, a concurrent request with the same key committed first.
The adapter then reads the winning row and checks its payload hash, exactly
like a retry. The same payload returns the original handoff, and a different
payload gets the usual idempotency error. Exactly one `created` event is
written.

One clock: the Postgres adapter takes `created_at` and `updated_at` from the
database clock (`clock_timestamp()` in UTC, in `toISOString` format), not from
each host. Host clock skew therefore cannot reorder inboxes or event
histories.

## Audit-trail parity with SQLite

| Property | SQLite | Postgres |
| --- | --- | --- |
| One event per state change | yes | yes |
| Event written in the same transaction as the change | yes | yes |
| Rejected transition writes no event | yes | yes |
| Idempotent replay writes no event | yes | yes |
| One notice per new handoff, none on replay (opt-in sink) | yes | yes |
| Event fields (`id`, `actor`, `event_type`, `from_status`, `to_status`, `note`, `created_at`) | same | same |
| Ordering | `created_at, rowid` | `created_at, seq` |
| Updates and deletes of events by the server | none | none |

The adapter contract test in `test/store-postgres.test.ts` runs the same
lifecycle and audit assertions against both adapters.

Neither store blocks a database operator from editing events. A later
migration could add an append-only trigger to both stores in the same version.
It is out of scope here.

## Backup and restore

- `agent-handoff-mcp backup` and `restore` are **SQLite only**. They use
  `VACUUM INTO`, a file lease and a combined registry snapshot (see
  `RECOVERY.md`). With `HANDOFF_STORE=postgres` the CLI refuses unless `--db`
  is given explicitly, so an operator cannot back up an unused SQLite file
  and believe the Postgres data is safe.
- For Postgres, use the database's own tools. Use `pg_dump --format=custom`
  for logical snapshots and `pg_restore` into a fresh database. Use
  continuous archiving or point-in-time recovery for active queues. The dump
  includes `schema_migrations`, so a restored database migrates forward in
  the normal way at startup.
- The registry is still a separate file. Back it up with the database dump,
  as one recovery set. As with SQLite there is no joint transaction between
  registry and database, so pause provisioning changes during the backup.
- Restore into a fresh database, then point every host at it, as with SQLite.
  Stop all hosts first. The SQLite live-server lease does not exist for
  Postgres, so the operator must make sure no host is still writing.
- Backups hold private handoff content. Protect them like the database.

## Multi-host, and the answer to issue #17

Issue #17 asks how two agents that do not share a host or a SQLite file pass
working context, and whether an unauthenticated, short-lived capability URL
belongs next to the inbox.

**Answer.** Cross-host handoff stays inside the authenticated inbox: run one
shared handoff service over HTTP (one SQLite host, or with this adapter
several hosts on one Postgres) and give each agent its own bearer identity.
Unauthenticated capability links are out of scope for this project.

Detail:

- Today, agents on different machines can already share one store. Point
  them all at **one** HTTP server with their own bearer tokens. SQLite on
  that single host is enough. A second SQLite file on another host is a
  separate store, and the two cannot see each other's handoffs.
- The Postgres adapter covers the next step: **several server hosts** (for
  redundancy, or a stdio server on each machine) sharing one store. It gives
  the same lifecycle, idempotency and audit behaviour as SQLite, with row
  locking across hosts.
- Every host must load the **same registry** (same identities, relationships,
  disclosure ceilings and token digests). Distribute it as an operator-owned
  file, for example from the deployment repository. Policy revisions are
  content hashes, so `/readyz` shows when hosts are out of step. A shared
  registry store is a possible later item, but it is not part of this change.
- A bearer link that anyone can read, with no sender or recipient, no
  disclosure ceiling and no audit trail, conflicts with the core model of
  this server. That model is explicit identities, explicit relationships,
  sensitivity ceilings and an append-only event history. Handoff content
  should stay inside that boundary. Non-secret scratch notes can go in a
  normal handoff with `sensitivity: public-safe`. Use `contextRefs` and
  `artifactRefs` to point at material that lives elsewhere.

## Testing

- `npm test` always runs the store-selection tests, the migration-parity test
  and the SQLite run of the adapter contract.
- `npm test` also always runs the Postgres suite against **PGlite** (Postgres
  compiled to WebAssembly, dev dependencies `@electric-sql/pglite` and
  `@electric-sql/pglite-socket`). PGlite runs in-process behind a loopback
  socket on a random port, so there is no container and no network. This
  checks the SQL, the migrations and the lifecycle logic on every CI run.
  PGlite is one backend that runs one transaction at a time, so the race
  tests pass there by serialisation. They do not prove row locking.
- The real-Postgres suite runs only when `HANDOFF_PG_URL` is set, and is
  otherwise reported as skipped. Point it only at a **local, throwaway** database, for
  example a disposable container:

  ```sh
  docker run --rm -d --name handoff-pg -e POSTGRES_PASSWORD=<local-only> -p 127.0.0.1:55432:5432 postgres:17
  HANDOFF_PG_URL=postgres://postgres:<local-only>@127.0.0.1:55432/postgres npm test
  docker rm -f handoff-pg
  ```

  Each suite creates its own `handoff_test_*` schema and drops it afterwards.
  The suite covers the shared contract, concurrent migration by three hosts,
  a newer schema being refused, two hosts racing to acknowledge one handoff
  (ten rounds, exactly one winner and one audit event each round), and
  concurrent retries of one idempotency key.
- Never point the tests at a hosted or shared database.

## Known gaps (experimental)

- Not yet run against a real multi-backend Postgres. CI runs the suite on
  PGlite only (see Testing). That proves the SQL and migrations work. It does
  not prove row-lock behaviour across separate backends. A CI job with a
  Postgres service container and `HANDOFF_PG_URL` is the next step.
  Workflow changes are left to the owner.
- No connection retry or backoff. If the database drops, calls fail with a
  store error until it comes back.
- `/readyz` reports registry state only. It does not yet check the database.
- Behind a transaction-mode pooler such as PgBouncer, the optional per-test
  `schema` (`SET search_path`) is not reliable. Production use should use the
  default schema.
- The registry is still per host (see above).
- The recovery CLI does not cover Postgres. Use `pg_dump` and `pg_restore`.
