# Add renew, release, done and fail, fenced by claim_seq, holder and device

Type: task
Status: resolved
Blocked by: 06
Test first: yes
Level: 3
Builder: backend
Touches: apps/server/src/tasks/report.ts, apps/server/src/tasks/fail-cascade.ts, apps/server/src/tasks/tasks-router.ts, apps/server/src/tasks/report.test.ts, apps/server/src/tasks/report-isolation.test.ts

Repo: sky-brain. spec.md § Stories "A worker pulls, claims and reports" (the rest), § Design
(the fenced update). Bar properties 3, 4, 7. Uses ticket 06's claim and ticket 04's
`withholdSecrets`.

- `apps/server/src/tasks/report.ts` (new): `POST /api/v1/tasks/:id/renew`, `/release` (verb
  `claim`), `/done` and `/fail` (verb `report`), all rate limited with strict bodies holding
  `claim_seq`. Each is one transaction around one conditional `UPDATE ... WHERE id = $id AND
  status = 'in_progress' AND claim_seq = $sent AND holder_actor = $actor AND holder_device IS
  NOT DISTINCT FROM $device AND lease_expires_at > $now`; no row → 409 `lease_lost`, except done
  on a task already `done` by this same holder and `claim_seq`, which is 200 with no new event.
  Renew and done on a cancelled goal → 409 `goal_cancelled` (release and fail still work, so a
  worker can free the task).
  - renew: `lease_expires_at = $now + 600 s`; event `renewed`.
  - release: back to `pending`, holder cleared; event `released`.
  - done: `status = done`, `proof` stored with each string passed through
    `withholdSecrets`; event `done`; returns `newly_ready`, the ids of tasks in the goal that
    the eligibility filter of ticket 06 now finds ready.
  - fail: `reason` through `withholdSecrets` into `fail_reason`, and `attempts = attempts + 1`
    (claims never change `attempts`; only fail counts, spec.md § Decisions); when the new
    `attempts < max_attempts` back to `pending` with holder cleared (event `failed`, `details.final:
    false`); else `failed`, and `apps/server/src/tasks/fail-cascade.ts` (new) marks every
    pending task that depends on it, directly or not (a recursive CTE over `task_deps`),
    `blocked`, in the same transaction, with `task.status` audit rows for each (event `failed`,
    `details: {final: true, blocked}`). Returns `{task, blocked}`.
- Every event through `writeTaskEvent` (ticket 05), so actor and device come from the token.

Tests: `report.test.ts` (new): renew moves the lease; after 601 s by the test clock the old
holder's renew and done get 409 `lease_lost`, and after another worker claims, the old holder's
done is still refused while the new holder's done succeeds (bar 3); a wrong `claim_seq`, a
different agent and a different device of the same person each get `lease_lost`; done twice is
harmless; a secret in proof and in a fail reason is stored as `[withheld: <rule>]`; fail below
`max_attempts` returns the task to `pending`; with `max_attempts` 3, two expired leases then one
fail leave `attempts` 1 and the task `pending`; the fail that brings `attempts` to `max_attempts` marks a chain of two dependents
`blocked`; cancel then renew is 409 `goal_cancelled`; each event's actor and device are the
token's, and a body naming `device_id` is 400 with no event (bar 7).
`report-isolation.test.ts`: workspace B gets 404 on every report route for workspace A's task
(bar 4); a token without `report` gets 403 on done and fail.

## Not in this ticket

- Pathly's renew thread and its handling of `lease_lost`: the pathly-adapters follow-up plan
  (map.md § Follow-up: Pathly client).
- A sweeper that expires leases: not needed (lazy expiry, spec.md § Decisions).

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/tasks/report.test.ts src/tasks/report-isolation.test.ts`
  passes, covering every case listed under Tests.
- All existing tests still pass, and `pnpm lint` and `pnpm typecheck` exit 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/tasks/report.test.ts src/tasks/report-isolation.test.ts
prints passed
$ pnpm test
$ pnpm lint
$ pnpm typecheck
```

## Reference

- spec.md § Design, § Edge cases, § Check order step 9, § Events and audit
- map.md § Decisions so far (fencing token)

## Answer

Work started at `cc34970cd7e4d6fb6af33067b3603453f307fd16`. Test-only commit `4600112`: the two
test files; at that commit the focused run failed 13 of 16 (every report route answered 404
"No such API route"; the 3 that passed are the 404 and 403 isolation cases, which the verb
table and the missing route already answer).

**Built**
- New: `apps/server/src/tasks/report.ts` (`reportHandlers` → renew, release, done, fail),
  `apps/server/src/tasks/fail-cascade.ts` (`blockDependents`).
- Changed: `apps/server/src/tasks/tasks-router.ts` (four `POST /:id/<verb>` routes behind the
  board-write limit; header comment).
- Tests: `report.test.ts` (12), `report-isolation.test.ts` (4).

**Proof** (run fresh after the last edit)
- `pnpm --filter @sky-brain/server exec vitest run src/tasks/report.test.ts
  src/tasks/report-isolation.test.ts`: 2 files, 16 tests passed. Cases: renew answers the lease
  600 s ahead of the clock and after 180+500 s another claim is still `already_claimed`; after
  601 s the old holder's renew and done are 409 `lease_lost` (proof stays null), after another
  worker claims (claim_seq 2) the old holder's done with seq 1 and 2 is `lease_lost`, the new
  holder is untouched and its done is 200 (bar 3); a wrong `claim_seq`, another device of the
  same person, another agent of the person and the person themself get `lease_lost` on all four
  routes, nothing changes, no event; release gives pending, holder cleared, next claim seq+1,
  `released` event and `task.status` audit; done stores the proof, returns `newly_ready` (the
  two dependents now ready, not the one still waiting on another task), done twice is 200 with
  one `done` event; a GitHub PAT in proof (gate summary, summary) and in a fail reason is stored
  as `[withheld: github-pat]`; fail below `max_attempts` → pending, attempts 1, reason stored,
  event `failed {final: false}`; `max_attempts` 3 with two expired leases then one fail →
  attempts 1, pending; the fail that brings attempts to `max_attempts` (2) → `failed`, a chain
  of two dependents `blocked`, an unrelated task stays pending, event `{final: true, blocked}`,
  one `task.status` audit per blocked task, a blocked task's claim is `not_ready`; cancel then
  renew and done are 409 `goal_cancelled` (a wrong seq there is still `lease_lost`), release and
  fail still free tasks; every event's actor, device and on_behalf_of are the token's; a body
  with `device_id` or `actor` is 400 on all four routes with no event (bar 7). Isolation:
  workspace B's owner, B's agent and a B run token get 404 on all four routes for A's task; run
  tokens of another project and another workspace's project of the same person get 404 (bar 4);
  a token without `report` gets 403 `verb_not_allowed` on done and fail, without `claim` on
  renew and release; a viewer gets 403 `role_cannot_write`; the task stays as it was.
- `pnpm test`: shared 3 files / 30 tests, server 36 files / 439 tests, exit 0.
- `pnpm lint` exit 0; `pnpm typecheck` exit 0.
- Not required: acceptance (`pnpm exec vitest run --root plans/cloud-task-board/acceptance`)
  7 files / 102 tests passed (ticket 06 left 34 failing on these routes).

**Decisions**
- Order inside one transaction: `findTask(..., forUpdate)` (404) → run scope (404) → writer
  (403) → the conditional `UPDATE ... RETURNING` with the fence. No row: the same fence is
  selected again; if it matches, only the cancelled goal stood in the way (renew/done) →
  `goal_cancelled`, else `lease_lost`. So `lease_lost` answers before `goal_cancelled` (Check
  order step 9) and the condition is written once (`liveLease`).
- The fence also checks `holder_person` (the person the agent acts for). Two people's agents
  without a device token and with the same `agent_id` have the same `holder_actor`; the person
  tells them apart. Stricter than the ticket's list, never looser.
- Done keeps `holder_*` (only status and proof change) so a repeat done can match the holder;
  the wire `holder` is null anyway once not in progress. Release and fail clear holder and
  `lease_expires_at`. `claim_seq` never changes outside claim.
- Done again: a row that is `done` with the same `claim_seq`, actor, person and device → 200,
  no event or audit; it answers before the cancelled-goal check.
- `newly_ready`: direct dependents of the done task that `eligibleTask` (ready/claim's filter,
  with the caller's person and run scope) now passes — "the ids that became ready" (spec). Tasks
  of the goal that were already ready before are not listed.
- Fail: `final` = `attempts + 1 >= max_attempts`, read from the row `findTask` locked;
  `attempts = attempts + 1` in SQL. The cascade is a recursive CTE over `task_deps` (`union`,
  so it ends on any graph) and blocks only `pending` dependents, each with a `task.status`
  audit `{from: pending, to: blocked, via: fail, failed_task}`.
- Audit `task.status` for release, done and fail (`{from: in_progress, to, via}`); renew changes
  no status, so it writes only the `renewed` event.
- Proof: every string (`gates[].name`, `gates[].summary`, `commit`, `pr_url`, `summary`) goes
  through `withholdSecrets`; absent keys stay absent.

**Shortcuts taken**
- none

**For later tickets**
- `run-tokens/tests/fixture.ts` still says the claim probe route is a stub "until tickets 04-07
  land"; it is only a comment on the test-only app (not in this ticket's Touches).
- 13 (acceptance): the acceptance suite now passes 102/102 on this branch.

