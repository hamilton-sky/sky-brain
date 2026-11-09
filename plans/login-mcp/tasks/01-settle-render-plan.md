# Settle hosting: record shammai's answer, Vercel with Postgres on Nanogres

Type: settle
Status: resolved
Blocked by: —
Test first: no
Level: 3

This ticket first asked whether to keep the paid Render plan or use a free Render tier for the
T0 spike. shammai has since answered a different and final way (2026-11-09, relayed by the
session in the repair of this plan): **everything runs on Vercel at
`https://sky-brain.vercel.app`, with Postgres on Nanogres.** Render is gone. Nobody needs to ask
shammai again: the answer below is his, and the code for it is already on the base branch.

What is already built (PR #3, merged into `claude/brain-core`, which this branch is rebased on):
`vercel.json` (install, build, migrations in the build for production deploys only, one function
`api/index.mjs` with `maxDuration` 60, and rewrites of `/healthz`, `/api/*`, `/mcp`,
`/.well-known/*`, `/sign-in`, `/consent`, `/auth-pages/*` and `/auth/*` to that function),
`apps/server/src/vercel.ts` (the Express app as the function), `render.yaml` removed,
`docs/PLAN.md` section 12 rewritten, and `docs/DECISIONS.md` D16 "Host everything on Vercel,
with Postgres on Nanogres". The facts it rests on are in D16 and on map.md's repair lines.

The builder writes no code and no decision (D16 already is the decision). Write the Answer
below: the choice, one line of why in shammai's words, and the rejected options.

Answer to write, in substance:

- **Chosen: Vercel + Nanogres (D16).** shammai: "everything on Vercel" instead of Render. The
  Express app is one Vercel function; Postgres is Nanogres over TLS PgBouncer (`DATABASE_URL`
  app role on port 6432; `MIGRATION_DATABASE_URL` on port 6433 with `MIGRATION_DATABASE_ROLE`
  for the migrations, which run in the Vercel build).
- **Rejected:** Render paid (`render.yaml` as brain-core 01 wrote it) and Render free for a T0
  spike (sleeps after 15 minutes, about a minute to wake against claude.ai's 10-second OAuth
  wait; free Postgres deleted after 30 days).
- **For later tickets:** no `render.yaml` work anywhere (ticket 06 only lists the Vercel
  environment variables and writes `docs/CONNECT.md`); no state in process memory may be
  relied on across requests (spec.md Decisions → Serverless); nothing may use session-level
  Postgres features through PgBouncer (spec.md Risks).

## Not in this ticket

- Any change to `vercel.json`, `api/index.mjs` or `apps/server/src/vercel.ts`: ticket 02 plugs
  the auth instance into `vercel.ts`; no new top-level route is needed (spec.md Interfaces →
  Routes; every new path is under one that `vercel.json` already rewrites).
- The environment variable list and `docs/CONNECT.md`: ticket 06.
- A new decision in `docs/DECISIONS.md`: D16 already records this.

## Done when

- The Answer section says Vercel + Nanogres (D16) was chosen, quotes shammai's reason, and names
  the two Render options as rejected.

## Reference

- `docs/DECISIONS.md` D16, `docs/PLAN.md` section 12, `vercel.json`, `apps/server/src/vercel.ts`
  (all read-only here).
- map.md § Decisions so far (the repair lines on hosting).

## Answer

**Chosen: Vercel + Nanogres (D16, `docs/DECISIONS.md` "Host everything on Vercel, with Postgres
on Nanogres").** shammai's reason, as D16 records it: he asked for "everything on Vercel"
instead of Render (2026-11-09). The whole app is one Vercel project at
`https://sky-brain.vercel.app`: the Vite build is the static output and the Express app is one
function (`api/index.mjs`, `maxDuration` 60, re-exporting `apps/server/dist/vercel.mjs` built
from `apps/server/src/vercel.ts`). Postgres is Nanogres over TLS PgBouncer: `DATABASE_URL` is
the app role on port 6432; `MIGRATION_DATABASE_URL` is the migrate role on port 6433, which runs
`SET ROLE` to `MIGRATION_DATABASE_ROLE` before the migrations (`docs/PLAN.md` section 12). The
migrations run in the Vercel build for production deploys only.

**Rejected:**

- **Render paid** (`render.yaml` as brain-core 01 wrote it: `0.5c-512mb` web service,
  `0.1c-256mb` Postgres 18, migrations as `preDeployCommand`; map.md plan line on
  `LOGIN-MCP-PLAN.md`'s sketch). Superseded by D16; `render.yaml` is removed.
- **Render free for a T0 spike**: a free web service sleeps after 15 minutes without traffic
  and takes about a minute to wake, far past claude.ai's 10-second wait on OAuth discovery and
  token calls; free Postgres is deleted 30 days after creation (map.md plan lines on the Render
  free tier and claude.ai's OAuth wait).

**For later tickets:**

- No `render.yaml` work anywhere. Ticket 06 only lists the Vercel environment variables and
  writes `docs/CONNECT.md`.
- No state in process memory may be relied on across requests (spec.md Decisions →
  Serverless).
- Nothing may use session-level Postgres features through PgBouncer: no `LISTEN`, no session
  advisory locks, no `SET` outside a transaction, no named prepared statements across
  transactions (spec.md Risks → PgBouncer). `SET ROLE` stays in the migrate script.
- No new top-level route: every path login-mcp adds sits under one `vercel.json` already
  rewrites to the function (`/api/*`, `/.well-known/*`, `/sign-in`, `/consent`, `/auth/*`,
  `/auth-pages/*`, `/mcp`).

- **Built**: this Answer and the Status line of this ticket; one line appended to `map.md`. No
  code (settle ticket).
- **Proof**: the Done when bullet. The Answer above names "Vercel + Nanogres (D16)" as chosen,
  quotes shammai's reason ("everything on Vercel" instead of Render, D16 Why), and names "Render
  paid" and "Render free for a T0 spike" as rejected. Checked by
  `grep -n 'Chosen: Vercel + Nanogres (D16\|everything on Vercel\|Render paid\|Render free' plans/login-mcp/tasks/01-settle-render-plan.md`,
  which prints the lines in the Answer. The facts were re-read on aa14620: `render.yaml` absent
  (`ls render.yaml`: no such file), `vercel.json` rewrites and `maxDuration` 60, `api/index.mjs`
  re-export, `vercel.ts` (`max: 3`, `attachDatabasePool`, throws without `DATABASE_URL`), D16 at
  `docs/DECISIONS.md` line 191, ports 6432/6433 at `docs/PLAN.md` lines 246-247.
- **Decisions**: none new; D16 is the decision. The "production deploys only" rule for
  migrations is enforced by `apps/server/src/db/migrate-cli.ts` (it exits 0 when `VERCEL` is set
  and `VERCEL_ENV` is not `production`), not by `vercel.json`, whose `buildCommand` always calls
  `migrate`.
- **Shortcuts taken**: none.
- **For later tickets**: the bullets above. Out of this ticket and noted only:
  `plans/brain-core/acceptance/developer.test.ts` (scout lead, not re-run) still expects
  `render.yaml`; `docs/ROADMAP.md` and `docs/layer-1/` still mention Render. Neither is in any
  login-mcp ticket's scope.
