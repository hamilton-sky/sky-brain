# Add the ready list and the claim: eligibility filter, lease, fencing number and file overlap

Type: task
Status: open
Blocked by: 05
Test first: yes
Level: 3
Builder: backend
Touches: apps/server/src/tasks/eligibility.ts, apps/server/src/tasks/ready.ts, apps/server/src/tasks/claim.ts, apps/server/src/tasks/file-overlap.ts, apps/server/src/tasks/tasks-router.ts, apps/server/src/tasks/ready-claim.test.ts, apps/server/src/tasks/file-overlap.test.ts, apps/server/src/tasks/claim-isolation.test.ts

Repo: sky-brain. The heart of the brainstorm's chosen option (spec.md § Design, § Stories "A
worker pulls, claims and reports", first five criteria). Bar properties 1, 2, 5, 6 (second half)
and part of 7.

- `apps/server/src/tasks/eligibility.ts` (new): one Drizzle SQL condition used by both ready
  and claim, so they can never disagree: the task's workspace has a `members` row for the
  caller's person; the run token's workspace and project match (when there is one); the goal is
  `approved` and `approved_by = person OR assignee = person`; the goal and the task have no
  `quarantined_because`; `approved_hash = text_hash`; every row in `task_deps` for the task
  points at a `done` task; and the task is `pending`, or `in_progress` with `lease_expires_at <=
  $now`. `$now` is the app clock, passed as a parameter.
- `apps/server/src/tasks/ready.ts` (new): `GET /api/v1/tasks/ready` (verb `read`;
  `project_id` required unless the caller has a run token, which supplies it; a different
  `project_id` is 404; `goal_id?`; `limit` 1..100, default 20), ordered by goal `created_at`
  then task `position`.
- `apps/server/src/tasks/file-overlap.ts` (new): `overlaps(a, b)` with Pathly's rule from
  pathly-adapters' file-claims module, written out here so no other repo is needed:
  normalize `\` to `/` and drop a trailing `/`; equal, or one is a folder prefix of the other;
  null or empty means everything.
- `apps/server/src/tasks/claim.ts` (new): `POST /api/v1/tasks/:id/claim` (writer, verb `claim`,
  rate limited, body `{}` strict). One transaction: `pg_advisory_xact_lock(
  hashtextextended('task-claim:' || project_id, 0))`; if the task's `files` overlap any other
  task of the project that is `in_progress` with a live lease → 409 `files_busy`; then one
  conditional `UPDATE ... SET status = 'in_progress', holder_actor, holder_person,
  holder_device, lease_expires_at = $now + 600 s, claim_seq = claim_seq + 1 (`attempts`
  unchanged) WHERE id = $id AND <eligibility> RETURNING`. No row: 409 `already_claimed` when the task
  is in progress with a live lease, else 409 `not_ready` (404 first when the caller may not see
  it at all). When the row it took was an expired `in_progress` row, write a `reclaimed` event
  (`details: {from_actor, from_device, from_claim_seq}`) before `claimed`. Audit `task.status`.
  Returns `{task, lease: {claim_seq, expires_at}}`.
- Route both in `tasks-router.ts`.

Tests: `ready-claim.test.ts` (new): ten concurrent claims (`Promise.all`) from ten agent actors
of the same person give exactly one 200 and nine 409 `already_claimed` (bar 1, on PGlite); a
task with a dependency not `done` is not in ready and its claim is 409 `not_ready` (bar 2);
tasks under a draft or cancelled goal, a held task, an unpinned task (its `title` changed in the
database after approval) are never ready nor claimable; a device of person P never sees or
claims a task of a goal approved by Q unless P is its assignee (bar 6); after 601 seconds by the
test clock the task reads `pending`, is ready, and the next claim gives `claim_seq` 2 and a
`reclaimed` then `claimed` event, and `attempts` is still 0 after both claims (only fail counts,
spec.md § Decisions); every event's actor and device are the token's (bar 7).
`file-overlap.test.ts`: the rule's cases, and two ready tasks with overlapping files cannot both
be in progress (bar 5). `claim-isolation.test.ts`: workspace B and a run token of another project
get 404 on ready and claim (bar 4); a token without `claim` gets 403 `verb_not_allowed`.

## Not in this ticket

- Renew, release, done and fail: ticket 07.
- The race on a real Postgres: ticket 08.
- Counting expiry toward `max_attempts`: not done (spec.md § Decisions).

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/tasks/ready-claim.test.ts src/tasks/file-overlap.test.ts src/tasks/claim-isolation.test.ts`
  passes, covering every case listed under Tests.
- All existing tests still pass, and `pnpm lint` and `pnpm typecheck` exit 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/tasks/ready-claim.test.ts src/tasks/file-overlap.test.ts src/tasks/claim-isolation.test.ts
prints passed
$ pnpm test
$ pnpm lint
$ pnpm typecheck
```

## Reference

- spec.md § Design (claim transaction), § Decisions, § Check order step 9
- map.md § Decisions so far (Read Committed, advisory locks, the PGlite spike)
- Pathly's file-claims module in pathly-adapters (the rule above; not needed to build)

## Answer
