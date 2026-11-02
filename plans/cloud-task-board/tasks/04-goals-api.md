# Add the goals API: create a draft, list, get, and human-only approve, cancel and release

Type: task
Status: open
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
