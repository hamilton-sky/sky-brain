# Add the goals API: create a draft, list, get, and human-only approve, cancel and release

Type: task
Status: resolved
Blocked by: 03
Test first: yes
Level: 3
Builder: backend
Touches: apps/server/src/tasks/goals-router.ts, apps/server/src/tasks/goals-service.ts, apps/server/src/tasks/wire.ts, apps/server/src/tasks/write-guards.ts, apps/server/src/tasks/write-guards.test.ts, apps/server/src/tasks/goals.test.ts, apps/server/src/tasks/goals-isolation.test.ts, apps/server/src/app.ts

Repo: sky-brain. spec.md § Stories "A person and their agents put work on the board" (the goal
half), § Routes (the six `/api/v1/goals` routes except `/tasks`), § Check order.

- `apps/server/src/tasks/goals-router.ts` and `goals-service.ts` (new), mounted on
  `/api/v1/goals` in `createApp`; `createApp` also creates one `createRateLimiter()` for every
  board write (keyed by `actorKey(actor)` plus the device id when there is one) and hands it to
  the routers.
- Create: always `draft`; target scope from `project_id` (and `feature_id`, which must belong
  to that project) with `resolveScope`; writer only (`effectiveRole` from ticket 02 for run
  tokens, verb `plan`, `assertRunScope`); an agent sending `assignee` gets 403
  `agent_cannot_assign`; a human's `assignee` must be a writer of the workspace, else 400
  `invalid_request` field `assignee`. Writes `goal.create` audit row in the same transaction.
- `apps/server/src/tasks/write-guards.ts` (new): one place for the board's secret and
  quarantine handling, used here and by ticket 05: `refuseSecrets(fields)` (422
  `secret_detected` with `rule`, via `scanForSecrets`), `heldBecause(title, body)` (via
  `detectInjection`), and `withholdSecrets(text)` returning `[withheld: <rule>]` when the text
  holds a secret (used by ticket 07).
- List and get: member only; an agent gets 404 for a held goal and never sees one in the list;
  `GET /:id` returns `{goal, tasks}` with tasks in `position` order, each task's effective
  status (an `in_progress` row whose `lease_expires_at <= now` reads `pending` with `holder`
  null), `depends_on` and `pinned`; `goal.counts` by effective status. Agents never see held
  tasks in it. `apps/server/src/tasks/wire.ts` (new) maps rows to the wire types.
- Approve (human writer): 409 `invalid_state` for a cancelled goal, 409 `quarantined` when the
  goal or any of its tasks is held; else sets `status = approved`, `approved_by`, `approved_at`
  and every task's `approved_hash = text_hash`, returns `pinned` (how many tasks changed), audit
  `goal.approve`. Approving an approved goal again is allowed (it pins new or changed tasks).
- Cancel (human writer): 409 `invalid_state` when already cancelled; audit `goal.cancel`.
- Release (human writer): clears the goal's `quarantined_because`, 409 `invalid_state` when
  not held; audit `goal.release`.

Tests (`goals.test.ts`, `goals-isolation.test.ts`, `write-guards.test.ts`, new): an agent's goal
is `draft` (bar 6); an agent and an agent acting for an owner get 403 `humans_only` from
approve, cancel and release (bar 6); a viewer gets 403 `role_cannot_write` on create; secrets
422 with nothing stored; injection text stored held and hidden from agents; approve refused
while held, pins after release; approve of a cancelled goal 409; for every goals route, a
member of workspace B gets 404 on workspace A's goal (bar 4), and a run token of project A gets
404 on project B's goal; the rate limit answers 429 after the limiter's capacity.

## Not in this ticket

- `POST /api/v1/goals/:id/tasks` and task release-text: ticket 05.
- The ready list and claim: ticket 06. Renew and done after cancel: ticket 07.
- The web goals page: round two (R2-02).

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/tasks/goals.test.ts src/tasks/goals-isolation.test.ts src/tasks/write-guards.test.ts`
  passes, covering every case listed under Tests.
- All existing tests still pass, and `pnpm lint` and `pnpm typecheck` exit 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/tasks/goals.test.ts src/tasks/goals-isolation.test.ts src/tasks/write-guards.test.ts
prints passed
$ pnpm test
$ pnpm lint
$ pnpm typecheck
```

## Reference

- spec.md § Stories, § Routes, § Check order, § Size caps, § Events and audit
- `apps/server/src/scope/resolve-scope.ts`, `apps/server/src/guards/secrets.ts`,
  `apps/server/src/guards/quarantine.ts`, `apps/server/src/actor/require-human.ts` (read-only)

## Answer

Work started at `9bcd902693b0fc0744e1dcbbe60767ec370cfd0a`. Test-only commit `c968a39`: the three
test files; at that commit the focused run failed 3 files / 19 of 20 tests (`write-guards.test.ts`
on `Cannot find module './write-guards.ts'`, the route tests on 404 "No such API route.").

**Built**
- New: `apps/server/src/tasks/write-guards.ts` (`refuseSecrets`, `heldBecause`,
  `withholdSecrets`), `apps/server/src/tasks/wire.ts` (`hasLiveLease`, `effectiveTaskStatus`,
  `countTasks`, `toWireGoal`, `toWireTask`), `apps/server/src/tasks/goals-service.ts` (`findGoal`,
  `listGoals`, `goalTasks`, `goalWire`, `assertAssignable`, `createGoal`, `approveGoal`,
  `cancelGoal`, `releaseGoal`), `apps/server/src/tasks/goals-router.ts` (`goalsRouter`, plus the
  exported helpers `boardWriteLimit`, `parseRequest`, `pathId`, `assertWriter`).
- Changed: `apps/server/src/app.ts` (one `createRateLimiter` on the app clock for board writes,
  `/api/v1/goals` mounted after `/run-tokens`, before the `/api` 404).
- Tests: `apps/server/src/tasks/goals.test.ts`, `goals-isolation.test.ts`, `write-guards.test.ts`.

**Proof** (run fresh after the last edit)
- `pnpm --filter @sky-brain/server exec vitest run src/tasks/goals.test.ts
  src/tasks/goals-isolation.test.ts src/tasks/write-guards.test.ts`: 3 files, 26 tests passed.
  Cases under Tests: agent's, run token's and person's goal created `draft` (status/author/
  approved_by in the body 400); an agent acting for the owner and for the editor get 403
  `humans_only` from approve, cancel and release (a run token 403 `verb_not_allowed`), goal
  unchanged; viewer and viewer run token 403 `role_cannot_write` on create (and viewer on
  approve/cancel/release); secret in title/body 422 `secret_detected` rule `github-pat`, no goal
  and no audit row; instruction text stored held (201), agent and run token get 404 on it, it is
  missing from their list and held tasks are missing from their `GET /:id` and counts; approve
  409 `quarantined` while the goal or a task is held, pins after release; approve of a cancelled
  goal 409 `invalid_state`; workspace B's owner 404 on list, get, create, approve, cancel and
  release of A's goal, B's agent 404 on list/get/create; a run token of project A 404 on project
  B's goal (list, get, create) and on project C (other workspace); the 61st board write of one
  actor (30 creates + 30 cancels) 429 `rate_limited` with `Retry-After`, another person and reads
  unaffected, one second later allowed. Plus: assignee rules, feature of another project 404,
  title over cap 413 `too_large` field `title`, newest-first list, effective status / holder /
  depends_on / pinned / counts, re-approve pins only new or changed text, audit rows.
- `pnpm test`: shared 3 files / 30 tests, server 29 files / 370 tests, exit 0.
- `pnpm lint` exit 0; `pnpm typecheck` exit 0.
- Not required: acceptance `goals.test.ts` and `isolation.test.ts` still fail 21 tests, each on a
  route of tickets 05-07 (`/goals/:id/tasks`, `/tasks/...`).

**Decisions**
- Mint keeps its own limiter (ticket 02's Answer); the board limiter is a second
  `createRateLimiter` in `createApp`, keyed `actorKey(actor)|device:<id or none>`, taken after
  `requireHuman` and before the body is parsed (Check order 4, 5, 6). Ticket 05-07 routers take it
  as `limiter` and use `boardWriteLimit(limiter)`.
- 413 vs 400: `parseRequest` maps `tooLargeField` to 413 `too_large` with `field`, else
  `validate`'s 400. A non-uuid `:id` is 400 `invalid_request` from `validate(IdSchema)`, without
  a `field` (the value is a bare string).
- A `feature_id` not in `project_id` is 404 `not_found` ("No such scope."), like an unknown one,
  so a feature of another project is not revealed.
- A human's `assignee` must be an owner or editor of the goal's workspace, else 400 field
  `assignee` (checked after the role, Check order 8).
- 404 for goals answers "No such goal or task." (as `assertRunScope`); an agent asking for a held
  goal gets it before membership is even looked up.
- Approve, cancel and release run in one transaction with the goal row `FOR UPDATE`; approve sets
  `approved_by` to the latest approver on every approve (re-approve included), pins with one
  `UPDATE tasks SET approved_hash = text_hash WHERE approved_hash IS DISTINCT FROM text_hash`, and
  returns that row count as `pinned`.
- Goals get `created_at`/`updated_at` from the app clock (list order is `created_at desc, id desc`).
- Counts for an agent leave held tasks out, as its task list does.
- Audit details: `goal.create` `{on_behalf_of?, project_id, status, device_id?, quarantined_because?}`,
  `goal.approve` `{from, pinned}`, `goal.cancel` `{from}`, `goal.release` `{quarantined_because}`
  (pattern ids and states only).

**Shortcuts taken**
- Counts and dependencies are grouped in JS from one query each (not SQL `GROUP BY`): fine for a
  project's goals today; a project with thousands of tasks would want SQL counts and paging.
- `GET /api/v1/goals` has no paging (the spec has none).
- `goals.test.ts` moved the agent-only cases (body status 400, held on create, humans_only) into
  `goals-isolation.test.ts` to stay under 400 lines.

**For later tickets**
- 05: mount `POST /:id/tasks` in `goalsRouter` with `limit` first; load the goal with
  `findGoal(tx, actor, id, true)` inside the insert transaction so it serialises with approve, then
  `assertRunScope(req, goal)`, `assertWriter(req, role)`, 409 `invalid_state` for a cancelled goal,
  `refuseSecrets` over title, body, each file and context ref (field `tasks.<i>.files.<j>`), then
  `heldBecause(title, body)`; write `text_hash` with `taskTextHash`. Use `parseRequest` for 413.
- 06/07: take the same limiter (`createApp`'s `boardLimiter`) and `boardWriteLimit`; `wire.ts`
  has `hasLiveLease`/`effectiveTaskStatus`/`toWireTask` (no SQL twin yet: the ready query needs
  one for `lease_expires_at <= now`). 07 uses `withholdSecrets` for fail reasons and proof text.
