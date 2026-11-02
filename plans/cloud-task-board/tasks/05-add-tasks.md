# Add tasks to a goal with dependencies, and get and release a task

Type: task
Status: open
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
