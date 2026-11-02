# Add tasks to a goal with dependencies, and get and release a task

Type: task
Status: resolved
Blocked by: 04
Test first: yes
Level: 3
Builder: backend
Touches: apps/server/src/tasks/add-tasks.ts, apps/server/src/tasks/goals-router.ts, apps/server/src/tasks/tasks-router.ts, apps/server/src/tasks/task-events.ts, apps/server/src/tasks/add-tasks.test.ts, apps/server/src/tasks/tasks-isolation.test.ts, apps/server/src/app.ts

Repo: sky-brain. spec.md § Stories "A person and their agents put work on the board" (the task
half), § Routes (`POST /api/v1/goals/:id/tasks`, `GET /api/v1/tasks/:id`,
`POST /api/v1/tasks/:id/release-text`). Uses ticket 04's goals service and write guards.

- `apps/server/src/tasks/add-tasks.ts` (new), routed from `goals-router.ts` as `POST
  /:id/tasks`: writer only (verb `plan`, `assertRunScope`, `effectiveRole`), rate limited,
  409 `invalid_state` on a cancelled goal. Each task's `depends_on` entries are either a
  0-based index of an earlier task in this request or the id of a task already in this goal;
  anything else (a later index, another goal's task, an unknown id) is 400 `invalid_request`
  with `field` `tasks.<i>.depends_on` and nothing is stored. That rule alone keeps the graph
  acyclic, so no cycle search is needed. A secret anywhere (title, body, files, context refs)
  refuses the whole request with 422; injection text holds that task. `text_hash` is
  `taskTextHash(...)`, `approved_hash` stays null (an approved goal must be approved again),
  `position` continues the goal's order. One transaction: tasks, deps, a `created` event per
  task and a `task.create` audit row each.
- `apps/server/src/tasks/task-events.ts` (new): `writeTaskEvent(tx, {task, kind, req,
  claimSeq?, details?})`, the only writer of `task_events`. It takes actor, on-behalf-of and
  device from `actorOf(req)` and `runContextOf(req)`, never from a body; tickets 06 and 07 use
  it.
- `apps/server/src/tasks/tasks-router.ts` (new), mounted on `/api/v1/tasks` in `createApp`:
  `GET /:id` (member, verb `read`, agent 404 on a held task; effective status as in ticket 04)
  and `POST /:id/release-text` (human writer; 409 `invalid_state` when not held; audit
  `task.release_text`).

Tests (`add-tasks.test.ts`, `tasks-isolation.test.ts`, new): a goal with three tasks where 2 and
3 depend on 1 stores the deps and three `created` events whose actor is the caller; each bad
`depends_on` form is 400 with nothing stored; a secret in `files` is 422; injection text is held
and hidden from an agent's `GET`; tasks added to an approved goal are `pinned: false` until it
is approved again; a viewer gets 403; a cancelled goal 409; workspace B gets 404 on adding to,
getting and releasing workspace A's tasks (bar 4); a body with `actor` or `device_id` is 400.

## Not in this ticket

- Ready, claim and the file-overlap check: ticket 06.
- Editing, reordering or blocking a task by hand: round two (R2-03).

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/tasks/add-tasks.test.ts src/tasks/tasks-isolation.test.ts`
  passes, covering every case listed under Tests.
- All existing tests still pass, and `pnpm lint` and `pnpm typecheck` exit 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/tasks/add-tasks.test.ts src/tasks/tasks-isolation.test.ts
prints passed
$ pnpm test
$ pnpm lint
$ pnpm typecheck
```

## Reference

- spec.md § Routes, § Check order, § Size caps, § Events and audit
- `apps/server/src/tasks/goals-service.ts` and `write-guards.ts` (new, from ticket 04)

## Answer

Work started at `c8d6c0e575067e30303cd805358c7732c409f9cd`. Test-only commit `0d48458`: the two
test files; at that commit the focused run failed 2 files / 16 of 17 tests, each on 404 "No such
API route." (the routes did not exist).

**Built**
- New: `apps/server/src/tasks/add-tasks.ts` (`addTasksHandler`), `apps/server/src/tasks/task-events.ts`
  (`writeTaskEvent`, the only writer of `task_events`), `apps/server/src/tasks/tasks-router.ts`
  (`tasksRouter`, `findTask`: `GET /:id`, `POST /:id/release-text`).
- Changed: `apps/server/src/tasks/goals-router.ts` (mounts `POST /:id/tasks` behind `limit`),
  `apps/server/src/app.ts` (mounts `/api/v1/tasks` with the shared `boardLimiter`, before the
  `/api` 404).
- Tests: `apps/server/src/tasks/add-tasks.test.ts` (11 tests), `tasks-isolation.test.ts` (6).

**Proof** (run fresh after the last edit)
- `pnpm --filter @sky-brain/server exec vitest run src/tasks/add-tasks.test.ts
  src/tasks/tasks-isolation.test.ts`: 2 files, 17 tests passed. Cases under Tests: three tasks,
  2 and 3 depend on 1 (by index): deps rows, three `created` events with actor
  `agent:claude-code`, on_behalf_of the person, device null, claim_seq 0, `at` the app clock, and
  three `task.create` audit rows; a run token's event carries its device id; bad `depends_on`
  (index equal to own, later index, another goal's task, unknown id) 400 field
  `tasks.1.depends_on`, plus -1/"nope"/1.5 400, nothing stored (no task, event or audit); a
  secret in a file 422 field `tasks.1.files.1` rule `github-pat` (also context ref, title,
  body); injection text holds only that task, an agent's `GET` of it is 404; a task added to an
  approved goal is `pinned: false`, approve pins 1, then `pinned: true`; viewer and viewer run
  token 403 `role_cannot_write`; cancelled goal 409 `invalid_state`; workspace B's owner 404 on
  add, get (plain and held), release-text (held and plain), B's agent 404 on add and get; a run
  token of project A 404 on project B's and another workspace's add and get; `actor`/`device_id`
  at the top and inside a task 400. Plus: 50 tasks stored in order, 51 is 413, an over-cap title
  413 `tasks.1.title`, positions continue after an existing task, duplicate deps collapse, an
  agent naming a held task's id gets 400, GET effective status (expired lease reads pending, no
  holder), release-text audit `task.release_text` and 409 when not held, agent 403
  `humans_only`, run token 403 `verb_not_allowed`, viewer 403.
- `pnpm test`: shared 3 files / 30 tests, server 31 files / 387 tests, exit 0.
- `pnpm lint` exit 0; `pnpm typecheck` exit 0.
- Not required: acceptance still fails 56 tests, all I checked on routes of tickets 06-07
  (`/tasks/ready`, claim, renew, release, done, fail); its add-tasks, secrets and held-task get
  cases pass.

**Decisions**
- `writeTaskEvent(tx, {task, kind, req, at, claimSeq?, details?})`: `at` added to the planned
  signature, since the spec wants the app clock and `req` does not carry it; `claimSeq` defaults
  to the task row's. Actor string from `auditActor`, device from `runContextOf(req)?.deviceId`
  (a run token's device too).
- Check order in add tasks: path id and body (400/413), then the index rule (pure, so it runs
  with the shape, step 6); then in one transaction the goal `FOR UPDATE` (404), run scope,
  writer (403), cancelled (409), then ids in `depends_on` must be tasks of this goal (400), then
  secrets (422), then quarantine. An agent naming a held task of the goal gets 400 as for an
  unknown id, so a held task is not revealed. Duplicate deps in one task collapse to one row.
- Secrets are scanned in title, body, lane, every file and every context ref; the field is
  `tasks.<i>.files.<j>` etc. Lane was added beyond the spec's four: it is stored text too.
- `position` = `max(position)+1` under the goal lock (not `count(*)` as seeds do), so a gap can
  never repeat a position.
- `task.create` audit details: `{on_behalf_of?, goal_id, device_id?, quarantined_because?}`;
  `task.release_text`: `{on_behalf_of?, goal_id, quarantined_because}`.
- `GET /tasks/:id` and release-text: 404 for an agent when the task or its goal is held (as
  ticket 04 hides a held goal and so its tasks). release-text locks the task row
  (`FOR UPDATE OF tasks`).
- `add-tasks.ts` imports `assertWriter`, `parseRequest`, `pathId` from `goals-router.ts`, which
  imports `addTasksHandler`: an import cycle that is safe since nothing runs at load time.
  `invalidState`/`audit` of goals-service.ts are not exported (that file is outside Touches), so
  the 409 and audit writes are inline.
- release-text is not in `verbs.ts` (outside Touches): a run token gets 403 `verb_not_allowed`
  (step 3) before `humans_only` (step 4), which is the spec's order.

**Shortcuts taken**
- Events and audit rows are inserted one task at a time (up to 50 x 2 inserts in the
  transaction); a batch insert would do if 50-task requests become common.

**For later tickets**
- 06/07: `writeTaskEvent` needs `at: now()`; pass `claimSeq` when the event's number differs from
  the row you hold. `findTask(db, actor, id, forUpdate)` in `tasks-router.ts` gives the task and
  role with the agent/held 404 rules; mount ready before `/:id` routes in `tasksRouter` (Express
  would match `/ready` as `GET /:id` and answer 400 for a non-uuid).
