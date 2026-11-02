# Prove the claim race and the file-overlap lock on a real Postgres in CI

Type: task
Status: open
Blocked by: 06
Test first: no
Level: 3
Builder: backend
Floor: allow config
Touches: apps/server/src/tasks/claim-race.pg.test.ts, apps/server/vitest.config.ts, apps/server/vitest.pg.config.ts, apps/server/package.json, .github/workflows/ci.yml

Repo: sky-brain. PGlite runs one transaction at a time, so the `pnpm test` race cannot fail by
interleaving (map.md § Decisions so far). PLAN section 11 already promises "one smoke test
against a real Postgres in CI"; this is it. `Floor: allow config` because it edits the Vitest
config and CI. `Test first: no`: the test proves code ticket 06 already wrote.

- `apps/server/src/tasks/claim-race.pg.test.ts` (new): opens `createPostgresDb(
  process.env.TEST_DATABASE_URL)`, migrates, and throws a clear error (a failure, never a skip)
  when the variable is unset. With `startTestServer({ db })`: 20 concurrent claims of one ready
  task from 20 agent actors give exactly one 200; 10 tasks whose files all overlap, claimed
  concurrently, end with exactly one `in_progress`; 10 tasks with disjoint files all get 200.
  Each case uses its own workspace so the file can run twice on one database.
- `apps/server/vitest.config.ts`: `exclude: [...configDefaults.exclude, "**/*.pg.test.ts"]`,
  with `configDefaults` imported from `vitest/config`. Setting `exclude` replaces Vitest's
  default list (`**/node_modules/**`, `**/.git/**`), so it must extend `configDefaults.exclude`
  (map.md § Decisions so far, Vitest 5.0.5). new `apps/server/vitest.pg.config.ts`:
  include only `src/**/*.pg.test.ts`, the same timeouts.
- `apps/server/package.json`: script `"test:pg": "vitest run --config vitest.pg.config.ts"`.
- `.github/workflows/ci.yml`: a `postgres:18` service (`POSTGRES_PASSWORD: postgres`,
  `--health-cmd pg_isready ...`, `ports: ["5432:5432"]`, map.md § Decisions so far) and a step
  after `pnpm test`: `pnpm --filter @sky-brain/server test:pg` with `TEST_DATABASE_URL:
  postgres://postgres:postgres@localhost:5432/postgres`.

Locally, Postgres 16 binaries are in `/usr/lib/postgresql/16/bin` (initdb into a scratch folder,
then `pg_ctl start`), or `docker run postgres:18`.

## Not in this ticket

- Moving `pnpm test` to Postgres: tests stay on PGlite (D14).
- Postgres for the acceptance tests: they run on PGlite.

## Done when

- `pnpm test` does not run `claim-race.pg.test.ts` (it is excluded) and still passes, and
  `apps/server/vitest.config.ts` keeps Vitest's default excludes (`grep -n
  "configDefaults.exclude" apps/server/vitest.config.ts` prints the line).
- With a Postgres at `TEST_DATABASE_URL`, `pnpm --filter @sky-brain/server test:pg` passes the
  three cases; without the variable it fails with a message naming `TEST_DATABASE_URL`.
- `.github/workflows/ci.yml` runs `test:pg` against the service (a reviewer reads it; CI runs it
  on push).
- `pnpm lint` and `pnpm typecheck` exit 0.

```check
# The conductor runs this block before review.
$ pnpm test
$ grep -n "configDefaults.exclude" apps/server/vitest.config.ts
prints configDefaults.exclude
$ pnpm --filter @sky-brain/server test:pg
prints passed
needs a Postgres reachable at TEST_DATABASE_URL
$ pnpm lint
$ pnpm typecheck
```

## Reference

- `docs/PLAN.md` section 11; `docs/DECISIONS.md` D14
- `apps/server/src/db/client.ts` (`createPostgresDb`), `.github/workflows/ci.yml`

## Answer
