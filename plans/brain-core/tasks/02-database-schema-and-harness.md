# Add the Drizzle schema, migrations, dev database and PGlite test harness

Type: task
Status: resolved
Blocked by: 01
Test first: yes
Level: 3
Touches: apps/server/package.json, pnpm-lock.yaml, apps/server/drizzle.config.ts, apps/server/drizzle/, apps/server/src/db/, apps/server/src/testing/, apps/server/src/config.ts, apps/server/src/server.ts, apps/server/src/main.ts, apps/server/src/dev.ts, apps/server/src/config.test.ts, apps/server/src/server.test.ts, packages/shared/src/entry.ts, packages/shared/src/git-remote.ts, packages/shared/src/git-remote.test.ts, render.yaml, .prettierignore, docs/PLAN.md, docs/DECISIONS.md, CLAUDE.md

Build T2: the schema of PLAN section 5 in Drizzle, its drizzle-kit migrations, a database for
`pnpm dev` and production, and the test harness every later ticket uses.

Dependencies for `apps/server`: `drizzle-orm` 0.45.4, `@electric-sql/pglite` 0.5.14, `pg` and
`@types/pg`, and `drizzle-kit` 0.31.11 as a dev dependency (versions in map.md). Do not add
package scripts (the floor guard counts them as config): `CLAUDE.md` gains the command
`pnpm --filter @sky-brain/server exec drizzle-kit generate` (run after changing the schema).

`apps/server/drizzle.config.ts` (new): dialect `postgresql`, schema `./src/db/schema.ts`, out
`./drizzle`. Add `apps/server/drizzle/` to `.prettierignore` (generated snapshots).

`apps/server/src/db/schema.ts` (new) — exports the Drizzle tables under the names spec.md
Interfaces → How a test reaches the server gives (`workspaces`, `members`, `invites`,
`projects`, `features`, `entries`, `auditLog`, `devices`), all ids `uuid` with
`gen_random_uuid()`, times `timestamptz`; enums from `@sky-brain/shared/enums`:
- `workspaces` (id, name, created_at).
- `members` (workspace_id → workspaces ON DELETE CASCADE, user_id text, role, created_at;
  primary key workspace_id + user_id).
- `invites` (id, workspace_id → cascade, email, role, invited_by, created_at, accepted_at;
  unique workspace_id + email).
- `projects` (id, workspace_id → cascade, slug, name, git_remote nullable; unique
  workspace_id + slug, unique workspace_id + git_remote, unique id + workspace_id for the
  composite key below).
- `features` (id, project_id → projects cascade, slug, name, archived_at, created_at; unique
  project_id + slug, unique id + project_id).
- `entries`: every column in spec.md Interfaces → Wire types, among them `allow_agent_answers
  boolean not null default false` and `quarantined_because text` (nullable: the id of the
  quarantine pattern that held the entry, written once when it is stored);
  `seq bigint not null unique default nextval('entries_seq')` from a
  `pgSequence("entries_seq")`; `refs text[] not null default '{}'`; `confidence real` with a
  0..1 check; a check that `feature_id` is null or `project_id` is not; composite foreign keys
  (project_id, workspace_id) → projects (id, workspace_id) and (feature_id, project_id) →
  features (id, project_id), both cascading, so an entry can never hang off another
  workspace's project; `reply_to` and `supersedes` reference `entries.id` (a self reference
  needs `(): AnyPgColumn => entries.id`); `search` is a
  `customType` tsvector `generatedAlwaysAs` `setweight(to_tsvector('english', title), 'A') ||
  setweight(to_tsvector('english', body), 'B')` with a GIN index; btree indexes on
  (workspace_id, seq), (workspace_id, project_id, feature_id, kind, status), reply_to,
  supersedes.
- `audit_log` (seq bigint identity primary key, workspace_id uuid not null with **no foreign
  key**, actor text, action text, target_id uuid nullable, at, details jsonb default `{}`;
  index workspace_id + seq). No foreign key, so a `workspace.delete` row outlives its workspace
  (spec.md Decisions, "The audit log outlives the workspace row"). Make it append-only with a
  custom migration (`pnpm --filter @sky-brain/server exec drizzle-kit generate --custom
  --name=audit-append-only`, then write the SQL into the empty file it creates): a plpgsql
  function that raises, a `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger and a `BEFORE
  TRUNCATE ... FOR EACH STATEMENT` trigger (Postgres allows TRUNCATE triggers only per
  statement). Nothing in the code ever deletes or changes an audit row; the workspace delete
  keeps them too (spec.md Decisions, the user's decision).
- `devices` (id, user_id text, name, created_at, last_seen_at, revoked_at). No routes.

Generate the migration with drizzle-kit; never hand-edit generated SQL.

`apps/server/src/db/client.ts` (new): `type Db` (the Drizzle Postgres database type both drivers
share), `createPgliteDb(dataDir?)` (use `await PGlite.create(...)`; `memory://` or no dir is
in memory), `createPostgresDb(url)` (node-postgres), `migrateDb(db)` using the matching
migrator (`drizzle-orm/pglite/migrator` or `drizzle-orm/node-postgres/migrator`) on
`apps/server/drizzle`, and `closeDb(db)`. `src/db/migrate-cli.ts` (new) migrates the database in
`DATABASE_URL`; `render.yaml` gains `preDeployCommand:
pnpm --filter @sky-brain/server exec tsx src/db/migrate-cli.ts` (PLAN section 12).

`readConfig(env)` gains `databaseUrl` and `pgliteDataDir` (default `.pglite`); `start` uses
Postgres when `DATABASE_URL` is set, refuses to start (clear error, non-zero exit) when
`NODE_ENV` is `production` without it, and otherwise opens PGlite at `PGLITE_DATA_DIR` and
migrates it at start, and closes the database when the server stops. (`createApp` does not
take the database yet: the actor ticket wires it in.)

`apps/server/src/db/audit.ts` (new): `writeAudit(tx, { workspaceId, actor, action, targetId,
details })` inserts one `audit_log` row (`actor` is a string, see the actor ticket's
`auditActor`). It only inserts; there is no update or delete path anywhere in the code.

`apps/server/src/db/entries-view.ts` (new): `toWireEntry(row, now)` maps a row to the spec's
wire `Entry` (snake_case, ISO dates) with the **effective status**: a `proposed` or `open` entry
whose `expires_at` is at or before `now` reads `expired`; `quarantined_because` is the column
while the effective status is `quarantined`, else `null` (spec.md Interfaces → Wire types); plus
the matching SQL condition for "not expired at now", for queries. `packages/shared/src/entry.ts` (new) holds the `Entry` wire
type.

`packages/shared/src/git-remote.ts` (new): `normalizeGitRemote(input): string | null`, exactly
as spec.md Interfaces → Git remote normalization, with a test covering every row of that table.

`apps/server/src/testing/harness.ts` (new): `createTestDb`, `closeTestDb`, `seedWorkspace`,
`seedProject` (stores the normalized remote), `seedFeature`, `seedEntry`, with the signatures
in spec.md Interfaces → How a test reaches the server. Tests in `apps/server/src/db/` prove:
migrations apply to an empty PGlite; an inserted entry is found by full-text search on a
stemmed word of its body; `seq` values are unique and grow, and a status update that draws
`nextval('entries_seq')` gives a higher seq; an entry whose project belongs to another
workspace is refused by the database; updating, deleting and truncating `audit_log` each raise
and leave the rows; deleting a workspace whose entries include a `supersedes` pair and an
answer to a question removes its members, invites, projects, features and entries, leaves its
`audit_log` rows, and leaves another workspace's rows; `writeAudit` inserts a row;
`toWireEntry` reports `expired` past `expires_at`, and shows `quarantined_because` for a
quarantined row and `null` for the same row once its status is `approved`.

Docs: `docs/PLAN.md` section 5 gains the `allow_agent_answers` and `quarantined_because` rows,
a line on the composite keys, and a line saying `audit_log` has no foreign key and a trigger refuses update, delete and
truncate; `docs/DECISIONS.md` gains a decision (next free number) for PGlite as the dev
database when `DATABASE_URL` is unset.

## Not in this ticket

- Routes that read or write entries: the entries tickets that follow.
- `startTestServer` and the actor: the actor ticket (03) adds them to the same harness file.
- Project and feature creation routes: out of this feature (map.md Open questions).
- A real-Postgres test: the deploy feature.
- The workspace delete route: the workspace delete ticket (09).

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/db --reporter=verbose` passes, covers the
  migration, full-text, seq, cross-workspace key, audit update/delete/truncate, cascade,
  expiry and `quarantined_because` cases, and the test names contain the `prints` lines of the check block below.
- `pnpm --filter @sky-brain/shared exec vitest run src/git-remote.test.ts` passes.
- `node tools/dev-smoke.mjs` prints `healthz 200` (dev start opens PGlite and migrates).
- `apps/server/drizzle/` holds the generated migration and the custom trigger migration, and the
  reviewer sees that `schema.ts` and the generated SQL agree.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/db --reporter=verbose
prints finds an entry by full-text search
prints refuses an entry whose project is in another workspace
prints refuses an update to audit_log
prints refuses a delete from audit_log
prints refuses a truncate of audit_log
prints deleting a workspace removes only its rows
prints deleting a workspace leaves audit_log alone
prints shows quarantined_because only while quarantined
$ pnpm --filter @sky-brain/shared exec vitest run src/git-remote.test.ts
exit 0
$ node tools/dev-smoke.mjs
prints healthz 200
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Interfaces (Wire types, How a test reaches the server, Git remote normalization),
  § Decisions (seq, expiry, scope as one id, PGlite for dev)
- map.md § Decisions so far (Drizzle and PGlite spikes, custom migrations and triggers,
  Postgres generated columns, Render keys)
- docs/PLAN.md section 5 (update it), docs/layer-1/TICKETS.md T2 (read-only)

## Answer

Work started at commit `792cae0a6ac90913a75f767ab5e20636ff42fa12`. The test-only commit is
`test(brain-core): 02 failing test`.

**Built**
- `apps/server/package.json` and `pnpm-lock.yaml`: dependencies `drizzle-orm` 0.45.4,
  `@electric-sql/pglite` 0.5.14, `pg` 8.23.1; dev dependencies `drizzle-kit` 0.31.11, `@types/pg`
  8.23.1. No scripts were added.
- `apps/server/drizzle.config.ts`. `apps/server/drizzle/0000_schema.sql` is generated by
  `drizzle-kit generate --name=schema`. `0001_audit-append-only.sql` came from `--custom` and
  holds the hand-written trigger SQL. `meta/` holds the snapshots and the journal.
- `apps/server/src/db/schema.ts`: the eight tables, five `pgEnum`s built from
  `@sky-brain/shared/enums`, `entriesSeq`, the tsvector `customType`, the checks, the composite
  keys and the indexes.
- `apps/server/src/db/client.ts`: `Db`, `DbOrTx`, `createPgliteDb`, `createPostgresDb`,
  `migrateDb` and `closeDb`.
- `apps/server/src/db/audit.ts`: `writeAudit`.
- `apps/server/src/db/entries-view.ts`: `toWireEntry`, `effectiveStatus`, `notExpiredAt` and
  `EntryRow`.
- `apps/server/src/db/migrate-cli.ts`.
- `apps/server/src/testing/harness.ts`: `createTestDb`, `closeTestDb`, `seedWorkspace`,
  `seedProject`, `seedFeature` and `seedEntry`; it re-exports `Db`.
- `apps/server/src/config.ts`: `Config` gains `databaseUrl`, `pgliteDataDir` (default: an
  absolute `apps/server/.pglite`) and `nodeEnv`.
- `apps/server/src/server.ts`: `start` opens the database and closes it on the server's `close`
  event. It also adds `closeOnSignals(server)` for SIGINT and SIGTERM.
- `apps/server/src/main.ts`: prints the start error and exits 1.
- `apps/server/src/dev.ts`: calls `closeOnSignals`.
- Tests: `src/db/schema.test.ts`, `src/db/audit.test.ts`, `src/db/entries-view.test.ts`,
  `src/config.test.ts` and `src/server.test.ts`.
- `packages/shared/src/entry.ts`: the `Entry` type.
- `packages/shared/src/git-remote.ts` and `git-remote.test.ts`.
- `render.yaml`: `preDeployCommand`.
- `.prettierignore`: `apps/server/drizzle/`.
- `CLAUDE.md`: the drizzle-kit command.
- `docs/PLAN.md` §5: the two new rows, plus paragraphs on the composite keys, the seq sequence
  and the audit trigger.
- `docs/DECISIONS.md`: D14.

**Proof** (each command run fresh after the last edit)
- `pnpm --filter @sky-brain/server exec vitest run src/db --reporter=verbose`: 3 files and 16
  tests passed, exit 0. All eight `prints` names are there:
  - finds an entry by full-text search (on a stemmed word of its body)
  - refuses an entry whose project is in another workspace
  - refuses an update to audit_log
  - refuses a delete from audit_log
  - refuses a truncate of audit_log
  - deleting a workspace removes only its rows
  - deleting a workspace leaves audit_log alone
  - shows quarantined_because only while quarantined

  The same run also covers these:
  - migrations create all 8 tables
  - seq values are unique and grow, and an update that draws `nextval` gets a higher seq
  - expiry happens at and past `expires_at`
  - `notExpiredAt` agrees with `toWireEntry`
  - `writeAudit` inserts a row

  The refusal tests check the Postgres cause, not just any error: the constraint names
  `entries_project_in_workspace_fk` and `entries_feature_in_project_fk`, and the trigger messages
  `append-only: UPDATE`, `DELETE` and `TRUNCATE`.
- `pnpm --filter @sky-brain/shared exec vitest run src/git-remote.test.ts`: 10 tests passed,
  exit 0. They cover every row of the spec table, including the three null rows.
- `node tools/dev-smoke.mjs`: printed `sky-brain listening on port 38747` and then `healthz 200`,
  exit 0. No tsx process was left behind.
- `drizzle-kit generate`, run again after the schema was finished, printed "No schema changes,
  nothing to migrate", so `schema.ts` and `0000_schema.sql` agree. `apps/server/drizzle/` holds
  `0000_schema.sql` and `0001_audit-append-only.sql`.
- `pnpm lint && pnpm typecheck && pnpm test`: exit 0. ESLint was clean and Prettier reported
  "All matched files use Prettier code style!". All three packages typecheck. Shared has 15/15
  tests and the server 27/27.
- Extra manual checks:
  - `NODE_ENV=production DATABASE_URL= tsx src/main.ts` printed "DATABASE_URL must be set when
    NODE_ENV is production; refusing to start" and exited 1.
  - Two start/SIGTERM runs on one on-disk PGlite folder both exited 0, and the second reopened
    the folder and re-ran the migrations cleanly.

**Decisions**
- Enums are Postgres `pgEnum`s (`role`, `entry_kind`, `entry_status`, `entry_source`,
  `author_kind`) built from the shared lists, so the database refuses unknown values too.
- `on_behalf_of` is `NOT NULL`, matching the wire type. `seedEntry` defaults: `authorKind`
  human, `author` `seed-user`, `onBehalfOf` the author (for an agent, `seed-user`), and
  `source` the same as the author kind.
- `seedProject` throws when it is given a remote that does not normalize. The harness is for
  tests, so this fails loudly.
- `migrateDb` and `closeDb` find each db's driver through a `WeakMap` filled by the two
  `create*` functions, so `Db` stays one shared `PgDatabase<PgQueryResultHKT, typeof schema>`
  type. A db not opened by `client.ts` throws.
- Postgres is not migrated in `start`, only in `preDeployCommand`. The ticket asks `start` to
  migrate only PGlite.
- The production check lives in `start`, so `Config` carries `nodeEnv`. An empty
  `DATABASE_URL` counts as unset.
- The default `pgliteDataDir` is resolved from `config.ts`'s location, not from the working
  directory, so it always lands in `apps/server/.pglite` (gitignored by `.pglite/`).
- `notExpiredAt(now)` also excludes a stored `expired` status, so it matches exactly
  `effectiveStatus !== "expired"`.
- The self references `reply_to` and `supersedes` keep `ON DELETE no action`. A workspace
  delete removes both sides in one statement, which the cascade test proves.
- The trigger raises with SQLSTATE `insufficient_privilege` and the message
  `audit_log is append-only: <OP> is not allowed`.
- The migration was named `--name=schema` instead of drizzle's random name. It is still pure
  drizzle-kit output.

**Shortcuts taken**
- `closeOnSignals` calls `server.closeAllConnections()`, which drops in-flight requests at once
  on SIGTERM. That is fine for an API with no long requests. It stops being fine if graceful
  draining matters on Render deploys; a drain timeout would fix it.
- `migrate-cli.ts` and the Postgres path in `start` are not tested against a real Postgres.
  That test belongs to the deploy feature, as the ticket says.

**For later tickets**
- 03: `start` still calls `createApp()` with no db. Pass `db` into `createApp` there; it is the
  `db` local in `start`. Use `Config.nodeEnv` for `devActorHeaderEnabled`. `startTestServer`
  goes into `src/testing/harness.ts` next to the seeds.
- Writes: use `db.transaction(async (tx) => ...)` and pass `tx` to `writeAudit` (`DbOrTx`). A
  status change must set `seq: sql\`nextval('entries_seq')\`` and `updatedAt`.
- Reads: `toWireEntry(row, now)` takes a full `entries` row (`EntryRow`). The `search` column is
  dropped from the wire. Filter non-expired rows with `notExpiredAt(now)`.
- Drizzle wraps Postgres errors in `DrizzleQueryError`. The Postgres message and code are on
  `err.cause`.
