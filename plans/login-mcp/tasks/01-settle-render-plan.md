# Settle the Render plan: keep the paid instance, or a free one for the T0 spike

Type: settle
Status: open
Blocked by: —
Test first: no
Level: 3

The brief asks for "a decision on free vs paid Render". The repo disagrees with itself:
`render.yaml` (committed by brain-core 01) asks for a paid web service (`plan: 0.5c-512mb`) and a
paid Postgres (`plan: 0.1c-256mb`, major 18) and migrates in `preDeployCommand`; `docs/PLAN.md`
section 12 says "Use a paid instance"; `docs/layer-1/LOGIN-MCP-PLAN.md` recommends the free tier
for T0 and the build.

shammai decides, because it changes what he pays and what can break:

- **A. Paid (recommended, the brief's assumption).** Keep `render.yaml` as it is. About the
  smallest paid web and Postgres plans per month; no sleep, so claude.ai's 10-second wait on the
  OAuth endpoints is safe; Postgres is not deleted and has backups; `preDeployCommand` keeps
  migrating.
- **B. Free, for a throwaway T0 spike only.** A free web service sleeps after 15 minutes idle and
  takes about a minute to wake (claude.ai gives up after 10 seconds), free Postgres is deleted 30
  days after creation (14-day grace) and has no backups, and pre-deploy commands may be paid-only,
  so migrations would move into the start command. Ticket 06 would then write a second, free
  Blueprint for the spike and keep the paid one as the real deploy.

Level 3 because it is a cost decision (what shammai pays each month) and decides whether the
database can be lost. The facts above are on map.md's source lines (Render free tier, claude.ai's
10-second OAuth wait) and in `plans/brain-core/map.md` (smallest paid plans, from
https://render.com/docs/blueprint-spec).

Write the answer below as `A` or `B` with one line of why. Ticket 06 records it as a decision in
`docs/DECISIONS.md` as D17 and changes `render.yaml` only if the
answer is B.

## Not in this ticket

- Writing the decision or changing `render.yaml`: ticket 06.
- The keep-alive cron from LOGIN-MCP-PLAN step 4: only needed with B; ticket 06 adds it then.

## Done when

- The Answer section says `A` or `B` and why, in shammai's words.

## Reference

- `render.yaml`, `docs/PLAN.md` section 12, `docs/layer-1/LOGIN-MCP-PLAN.md` ("Decisions to
  confirm" row 1 and "Deploy on Render's free tier"), all read-only here.

## Answer
