# Follow-ups: brain-core

What the run left for later: minor findings of passing reviews, the findings a level 2 ticket passed with after 2 review rounds, and Done when checks this host could not pass. Each is a candidate for a cleanup ticket.

## 01-scaffold-the-monorepo (left for later)

- 1. minor tools/dev-smoke.mjs: `fetch(url)` has no per-request timeout, so a server that accepts the connection but never answers would hang the script past the 120 s deadline - pass `{ signal: AbortSignal.timeout(POLL_MS * 4) }` or similar. (pair review)
- 2. minor .github/workflows/ci.yml: there is no `permissions:` block, so push runs get the repo's default token scope - add `permissions: contents: read` at the top level. (pair review)
- 3. minor CLAUDE.md: the Environment section already says `DATABASE_URL` is required in production and gives a default for `PGLITE_DATA_DIR`. Neither is implemented yet - leave it, but ticket 02 must make it true, or mark the lines as coming with the database ticket. (pair review)
- 4. minor apps/server/src/app.ts: every response carries `X-Powered-By: Express` - call `app.disable("x-powered-by")`. (pair review)
- 5. minor tsconfig.base.json: `types: ["node"]` is inherited by apps/web, so browser code type-checks against Node globals such as `process` - set `types: []` in apps/web/tsconfig.json, or add the DOM types only. (pair review)
