# Prove the claim race and the file-overlap lock on a real Postgres in CI

Type: task
Status: resolved
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

- **Built**: `apps/server/src/tasks/claim-race.pg.test.ts` (new), `apps/server/vitest.pg.config.ts`
  (new), `apps/server/vitest.config.ts` (exclude `**/*.pg.test.ts`, extending
  `configDefaults.exclude`), `apps/server/package.json` (`test:pg`), `.github/workflows/ci.yml`
  (`postgres:18` service with `pg_isready` health options, `test:pg` step after `pnpm test`).
- **Proof**:
  - `pnpm test` exit 0: server 36 files / 439 tests, shared 3 / 30; no `claim-race` in the
    output. `grep -n "configDefaults.exclude" apps/server/vitest.config.ts` prints
    `7:    exclude: [...configDefaults.exclude, "**/*.pg.test.ts"],`.
  - Local Postgres 16.15 (initdb in a scratch folder, port 55432):
    `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres pnpm --filter
    @sky-brain/server test:pg` -> `Test Files 1 passed (1)`, `Tests 3 passed (3)`, exit 0;
    run a second time on the same database: 3 passed again. Without the variable: exit 1,
    `Test Files 1 failed`, error `TEST_DATABASE_URL is not set: claim-race.pg.test.ts needs a
    real Postgres ...`. Sanity check (reverted, `git diff` of claim.ts empty after): with the
    `pg_advisory_xact_lock` call removed from claim.ts, the overlap case fails (1 failed,
    2 passed), so the test does catch a real interleaving.
  - `.github/workflows/ci.yml`: service `postgres:18`, `POSTGRES_PASSWORD: postgres`,
    `ports: ["5432:5432"]`, step `pnpm --filter @sky-brain/server test:pg` with
    `TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres` (YAML parsed with
    PyYAML).
  - `pnpm lint` exit 0, `pnpm typecheck` exit 0.
- **Decisions**: the missing-variable error is thrown at module load, so the file fails (never
  a skip, and no tests count as skipped). Agents are `server.as({kind: "agent", ...})` actors of
  the editor (no run token, as in ready-claim.test.ts). Each case calls the fixture's `world()`
  for a fresh workspace and project. The overlap case gives every task `src/shared` plus its own
  file so every pair overlaps (folder rule) and the losers must answer 409 `files_busy`; the
  20-way case expects 19 × 409 `already_claimed`.
- **Shortcuts taken**: none.
- **For later tickets**: 13 can cite `pnpm --filter @sky-brain/server test:pg` as the
  Postgres half of the race proof; it needs `TEST_DATABASE_URL`.
