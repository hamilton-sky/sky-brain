# Add the ready list and the claim: eligibility filter, lease, fencing number and file overlap

Type: task
Status: resolved
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

Work started at `c49a668cb05ccf8045f8fbc00722ebece4881b09`. Test-only commit `f714868`: the three
test files; at that commit the focused run failed 3 files / 13 of 14 tests (no `file-overlap.ts`
module; `/tasks/ready` answered 400 through `GET /:id`; claim 404 "No such API route").

**Built**
- New: `apps/server/src/tasks/eligibility.ts` (`eligibleTask`, `runScopeOf`),
  `apps/server/src/tasks/ready.ts` (`readyHandler`, `dependsOnMany`),
  `apps/server/src/tasks/claim.ts` (`claimHandler`, `LEASE_SECONDS`),
  `apps/server/src/tasks/file-overlap.ts` (`overlaps`).
- Changed: `apps/server/src/tasks/tasks-router.ts` (`GET /ready` before `GET /:id`;
  `POST /:id/claim` behind the board-write limit; header comment).
- Tests: `ready-claim.test.ts` (10), `file-overlap.test.ts` (20: 15 rule cases + 5 claims),
  `claim-isolation.test.ts` (5).

**Proof** (run fresh after the last edit)
- `pnpm --filter @sky-brain/server exec vitest run src/tasks/ready-claim.test.ts
  src/tasks/file-overlap.test.ts src/tasks/claim-isolation.test.ts`: 3 files, 35 tests passed.
  Cases: ten `Promise.all` claims by ten agents of one person give one 200 and nine 409
  `already_claimed`, one `claimed` event, claim_seq 1 (bar 1); a task with a dependency not done
  is not ready and is 409 `not_ready`, also while the dependency is in progress, and ready once
  it is `done` (bar 2); draft goal, cancelled goal, held goal, held task, unpinned task, and a task
  whose `title` was changed in the database after approval are never in ready (human or agent)
  and claim 409 `not_ready`, nothing changes; a device of the editor does not see or claim a goal
  the owner approved, does once the editor is its assignee, and the owner's device sees it (bar
  6); after 300 s a second claim is `already_claimed`, after 601 s the task reads `pending` with
  no holder, is ready, the next claim gives claim_seq 2, events `claimed`(1), `reclaimed`(2),
  `claimed`(2), `reclaimed.details = {from_actor, from_device, from_claim_seq: 1}`, `attempts` 0
  (row and wire); every event's actor, device and on_behalf_of are the run token's (bar 7); a
  body with `actor` or `device_id` is 400 and writes no event; viewer 403 `role_cannot_write`;
  unknown 404; the claim answers the lease 600 s ahead and audits `task.status` `{from: pending,
  to: in_progress, via: claim}`; ready orders by goal then position, filters `goal_id`, honours
  `limit`, 400 on a missing project_id (no run token), limit 0/101, unknown field, bad uuid.
  File overlap: the rule's 15 cases both ways; equal/folder overlap gives `files_busy` and the
  task stays pending; `src/ab.ts` vs `src/a` does not block; `null` and `[]` overlap both ways;
  two concurrent overlapping claims give one 200 and one `files_busy`; an expired lease no longer
  blocks; another project does not block (bar 5). Isolation: workspace B's owner, agent and run
  token get 404 on A's ready and claim; a run token of project A gets 404 on project B's and on
  another workspace's ready and claim; nothing changes; a token without `claim` 403
  `verb_not_allowed`, one without `read` 403 on ready (bar 4).
- `pnpm test`: shared 3 files / 30 tests, server 34 files / 422 tests, exit 0.
- `pnpm lint` exit 0; `pnpm typecheck` exit 0.
- Not required: acceptance 68 passed / 34 failed; the failures I read are ticket 07's routes
  (renew, release, done, fail) plus `goals.test.ts:263` (see For later tickets).

**Decisions**
- Claim order inside the transaction: `findTask` (404) → run scope (404) → writer (403) →
  advisory lock → `SELECT ... WHERE id AND <eligibility> FOR UPDATE` → no row: 409
  `already_claimed` when the row has a live lease, else `not_ready` → file overlap (409
  `files_busy`) → the conditional `UPDATE ... WHERE id AND <eligibility> RETURNING`. The overlap
  check runs only for an eligible task, so a task that is not ready answers `not_ready`, not
  `files_busy` (a dependent with `files: null` while its dependency runs would otherwise get
  `files_busy`; the acceptance suite expects `not_ready` there). The locked select also gives the
  old row for the `reclaimed` details.
- Pinned is `approved_hash = text_hash` **and** `approved_hash =` the task text hashed again in
  SQL (`encode(sha256(convert_to('[' || to_json(title)::text || ... || ']', 'UTF8')), 'hex')`),
  byte-identical to `taskTextHash()`. Reason: the ticket's test changes `title` in the database,
  which leaves the app-computed `text_hash` stale, so `approved_hash = text_hash` alone would
  still read pinned. A test seeds quotes, backslashes, control characters, U+2028, emoji and
  `files` null/[] and shows those tasks stay ready, so the two hashes agree.
- Both events carry the new claim_seq; the old one is in `reclaimed.details.from_claim_seq`.
  `task.status` audit details: `{on_behalf_of?, goal_id, from (effective), to, via: "claim",
  claim_seq, device_id}`.
- Ready: `project_id` from the query, else the run token's; resolveScope gives 404 for a
  non-member; `assertRunScope` 404 for another project. Order: goal `created_at`, goal id (a tie
  breaker), task `position`. Ready does not filter on file overlap (only claim does).
- `claim.ts` imports `findTask` from `tasks-router.ts`, which imports `claimHandler`: an import
  cycle like add-tasks/goals-router, safe since nothing runs at load time.

**Shortcuts taken**
- The file-overlap check reads every live in-progress task of the project and compares in JS
  (O(n·m) paths). Fine for tens of running tasks per project; a GIN index or a prefix table would
  be the upgrade if projects run hundreds at once.

**For later tickets**
- 07: reuse `LEASE_SECONDS` from `claim.ts`, `dependsOnMany` from `ready.ts`, and
  `eligibleTask` is not needed for renew/report (they fence on claim_seq + holder).
- Outside this ticket: `wire.ts` `pinned` and `approveGoal`'s pin still use the stored
  `text_hash`, so after a direct database title edit `GET /tasks/:id` still says `pinned: true`
  and approving again does not re-pin (acceptance `goals.test.ts:263`, "a task whose text changed
  after approval ..."). Claim and ready already refuse such a task. A fix: recompute `text_hash`
  in approve (or reuse the SQL hash in `eligibility.ts`) and in the wire mapping; a ticket that
  owns `goals-service.ts` and `wire.ts` should take it (13, or a follow-up).
