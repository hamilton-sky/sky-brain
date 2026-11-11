# Prove the round-one bar end to end

Type: task
Status: resolved
Blocked by: 01, 02, 04, 05, 06, 07, 08, 10
Test first: no
Level: 1

Repo: sky-brain. Runs map.md's bar on a fresh clone and
names the test that proves each of the eight properties. Fixes nothing itself: a failure goes
back to the ticket that owns it. No `Touches:` line, because it changes no file; any note goes
under Answer.

1. In a fresh clone of this branch: `pnpm install --frozen-lockfile && pnpm lint && pnpm
   typecheck && pnpm test` exits 0.
2. Each bar property's test passes on its own. All of these files are new on this branch,
   under `apps/server/src/`:
   1. race: tasks/ready-claim.test.ts (PGlite) and tasks/claim-race.pg.test.ts (Postgres,
      `test:pg`);
   2. unfinished dependency: tasks/ready-claim.test.ts;
   3. expired lease and refused late done: tasks/report.test.ts;
   4. workspace isolation on every route: tasks/goals-isolation.test.ts,
      tasks/tasks-isolation.test.ts, tasks/claim-isolation.test.ts,
      tasks/report-isolation.test.ts;
   5. overlapping files: tasks/file-overlap.test.ts and the pg race file;
   6. agent drafts only, never approves; device eligibility: tasks/goals.test.ts,
      tasks/ready-claim.test.ts;
   7. actor and device from the token: tasks/ready-claim.test.ts, tasks/report.test.ts,
      tasks/add-tasks.test.ts;
   8. expired or revoked run token: run-tokens/run-tokens.test.ts.
3. Write under Answer which commands ran, which `needs` checks were deferred and why, and
   that the live half of the brief's bar belongs to the pathly-adapters follow-up plan and
   round two (map.md § Follow-up: Pathly client, R2-10).

## Not in this ticket

- The live run of a three-task goal from a laptop with the phone watching, and any test in
  pathly-adapters: the pathly-adapters follow-up plan and round two (R2-10).
- The acceptance tests in `plans/cloud-task-board/acceptance/`: the conductor runs them itself
  once every ticket is resolved.

## Done when

- Every command in the block below exits 0 (the deferred ones with a reason under Answer).

```check
# The conductor runs this block before review.
$ pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test
$ pnpm --filter @sky-brain/server exec vitest run src/tasks src/run-tokens src/devices
prints passed
$ pnpm --filter @sky-brain/server test:pg
prints passed
needs a Postgres reachable at TEST_DATABASE_URL
```

## Reference

- map.md § Destination (the bar); spec.md § Goal and the bar

## Answer

Resolved 2026-11-11 on `claude/cloud-task-board-v1` (main b3c9965 plus this plan, merged).

Commands run, all exit 0:

- `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test`: shared 30 tests,
  server 515 tests (after the MCP board tools, projects routes and D20).
- `pnpm --filter @sky-brain/server exec vitest run src/tasks src/run-tokens src/devices src/mcp
  src/projects`: 196 passed.
- `pnpm exec vitest run --root plans/cloud-task-board/acceptance`: 102 passed.
- `pnpm --filter @sky-brain/server test:pg` against a local Postgres 16 (`TEST_DATABASE_URL`):
  3 passed (the claim race). CI runs it on Postgres 18.
- Upgrade path: main's migrations (0000 to 0002) then this branch's (0003 board tables, 0004
  task_events append-only triggers) applied to one Postgres database with `migrate-cli.ts`, as
  production will; both triggers present.
- `pnpm health` (RepNix, added in this session): no new findings.

Bar properties 1 to 8 are proved by the files the ticket lists; property 6 (eligibility) now
reads "approved by the caller's person" (D20). `mcp/board-tools.test.ts` adds the same story
over MCP with a real OAuth token: draft by the agent, refusal of agent approval, approval by the
person, next, claim, done with proof, and another person's project refused.

Deferred: the live half of the brief's bar (Pathly runs a three-task goal while the phone
watches) belongs to the pathly-adapters follow-up plan and round two (map.md § Follow-up: Pathly
client, R2-10).
