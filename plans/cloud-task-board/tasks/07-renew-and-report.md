# Add renew, release, done and fail, fenced by claim_seq, holder and device

Type: task
Status: open
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
