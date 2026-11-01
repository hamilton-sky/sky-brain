# Follow-ups: brain-core

What the run left for later: minor findings of passing reviews, the findings a level 2 ticket passed with after 2 review rounds, and Done when checks this host could not pass. Each is a candidate for a cleanup ticket.

## 01-scaffold-the-monorepo (left for later)

- 1. minor tools/dev-smoke.mjs: `fetch(url)` has no per-request timeout, so a server that accepts the connection but never answers would hang the script past the 120 s deadline - pass `{ signal: AbortSignal.timeout(POLL_MS * 4) }` or similar. (pair review)
- 2. minor .github/workflows/ci.yml: there is no `permissions:` block, so push runs get the repo's default token scope - add `permissions: contents: read` at the top level. (pair review)
- 3. minor CLAUDE.md: the Environment section already says `DATABASE_URL` is required in production and gives a default for `PGLITE_DATA_DIR`. Neither is implemented yet - leave it, but ticket 02 must make it true, or mark the lines as coming with the database ticket. (pair review)
- 4. minor apps/server/src/app.ts: every response carries `X-Powered-By: Express` - call `app.disable("x-powered-by")`. (pair review)
- 5. minor tsconfig.base.json: `types: ["node"]` is inherited by apps/web, so browser code type-checks against Node globals such as `process` - set `types: []` in apps/web/tsconfig.json, or add the DOM types only. (pair review)

## 02-database-schema-and-harness (left for later)

- 1. minor apps/server/src/db/schema.ts: `reply_to` and `supersedes` reference `entries.id` with plain foreign keys that are not tied to the workspace and have no on-delete action. Unlike `project_id`, the database lets an entry point at another workspace's entry. If a route ever misses its membership check, workspace B could link to workspace A's entry. Deleting workspace A (ticket 09) would then fail on `entries_reply_to_entries_id_fk` or `entries_supersedes_entries_id_fk`. - Add `unique(id, workspace_id)` on entries and make both into composite foreign keys (`reply_to`, `workspace_id`) and (`supersedes`, `workspace_id`) → entries(`id`, `workspace_id`). Or at least record this so the entries and delete tickets test it. (pair review)
- 2. minor packages/shared/src/git-remote.ts: the normalizer accepts things that are not remotes and keeps parts it should drop: (pair review)
- 3. minor apps/server/src/db/client.ts: the `pg.Pool` has no `'error'` listener. An idle-client error (a Postgres restart or failover on Render) is emitted as an unhandled `'error'` and crashes the process. - Add `pool.on("error", (err) => console.error(...))`. (pair review)
- 4. minor apps/server/src/main.ts: a start-up failure logs only `err.message`. For a migration failure that is Drizzle's generic `DrizzleQueryError` text, which loses `err.cause` (the real Postgres error) and the stack. - Log the error object, or include `err.cause`. (pair review)

## 03-actor-scope-and-membership (left for later)

- 1. minor apps/server/src/actor/middleware.ts: the check compares `req.hostname` to the loopback names case-sensitively, so `Host: LOCALHOST:port` is refused with `dev_actor_disabled`. It fails closed, but hostnames are case-insensitive. Lower-case `req.hostname` before the `LOOPBACK_HOSTS` lookup. (pair review)
- 2. minor apps/server/src/http/error-handler.ts: every exposed 4xx body error becomes 400 `invalid_json`, including 415 `charset.unsupported` and `encoding.unsupported`. The spec defines no 415, so this is acceptable. Its message, "The body could not be read.", is the only hint of the cause. Keep it as it is, or record it in the spec's edge cases. (pair review)

## 04-write-guards (left for later)

- 1. minor apps/server/src/guards/quarantine.ts: `ZERO_WIDTH` is a hand-picked list, so other invisible characters still slip through. `ig͏nore previous instructions` (combining grapheme joiner) and `ig⁣nore previous instructions` (invisible separator) both pass. To fix, strip `/\p{Default_Ignorable_Code_Point}/gu` instead of the list. This is minor because the spec calls the pattern list one illustrative layer, not a boundary. (pair review)
