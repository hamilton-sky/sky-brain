# Learnings: cloud-task-board

Things a fresh worker would otherwise waste time rediscovering: a command that works, a
trap, a quirk of the environment. Append one or two lines, newest last, tagged with your
ticket number. Never edit or delete another line. Keep it short; a human prunes it.

- (01) `pnpm exec prettier --write` is not idempotent on some chained calls; run it twice (or `pnpm lint`) before committing test files. drizzle-kit generate takes `--name <tag>` for the migration file name.
- (01) `app.set("trust proxy", 1)` is on: a test can act as another client address by sending `x-forwarded-for` through `server.anonymous.request(...)`; the device-flow limiters key on `req.ip`, so loops of `/api/device/code` from 127.0.0.1 share one burst of 60 per server.
- (01) `X-Forwarded-*` is trusted only when `devActorHeader` is off (`trustProxyHops`, app.ts); a test that fakes client addresses with `x-forwarded-for` must use a server without the dev actor header. To send a raw `Host` header use `node:http` `request`, not fetch (see app.test.ts `raw`).
- (02) In `db/auth-schema.ts`, anything from `schema.ts` used at table-build time (e.g. `roleEnum`) is undefined (circular re-export); only reference schema.ts tables inside callbacks. Test helpers outside `*.test.ts` and `src/testing/` get the strict lint rules (no `any`, unbound-method).
- (02) A shared test helper must sit under a `tests/` folder (or be named `*.test.ts`) to count as a test file for the test-first check; `test-fixture.ts` beside the tests counts as production code.
- (02) A route-level limiter keyed on the actor takes from the app clock (`createRateLimiter({ now: () => now().getTime() })`), so a test can refill it with the fixture's `advance()`.
- (03) `drizzle-kit generate --custom --name <tag>` writes an empty SQL file plus snapshot and journal entry; fill the SQL afterwards. A seed helper that takes a `world()` object with `featureId` passes it through: spread only the ids you mean.
- (04) `server.as({kind: "agent", ...})` gives an agent with no run token (no verb check), the way to reach `humans_only`; the run-token fixture writes `run_token.mint` audit rows into the workspace, so filter audit asserts by action. Prettier widens tests a lot: check `wc -l` against the 400-line rule before the test commit.
- (05) `tasksRouter` has `GET /:id` with `pathId`: ticket 06 must register `GET /ready` before it, or `/ready` answers 400 invalid_request. Acceptance (`pnpm exec vitest run --root plans/cloud-task-board/acceptance`) is a quick way to see which routes are still missing.
- (06) Raw `sql` inside an `UPDATE tasks` where clause can reference `${tasks.col}` (renders "tasks"."col"); a self-join in a subquery needs a literal alias (`join "tasks" as "dep"`). `to_json(text)::text` escapes exactly like `JSON.stringify`, so app-side JSON hashes can be recomputed in SQL.
