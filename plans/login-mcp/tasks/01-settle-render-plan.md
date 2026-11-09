# Settle hosting: record shammai's answer, Vercel with Postgres on Nanogres

Type: settle
Status: open
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
