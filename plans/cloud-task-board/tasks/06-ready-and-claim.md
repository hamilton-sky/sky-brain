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

**Round 1 send-back** (work restarted at `c053edb`; test-only commit `a8a604a`, where the
focused run failed 2 of 11 in `ready-claim.test.ts`: `liveTextHash` not exported, and GET
`/tasks/:id` answered `pinned: true` for a task edited in the database).

**Review fixes**
- Finding 1 (major), fixed. `eligibility.ts` exports the SQL hash as `liveTextHash`, and every
  place that decides "pinned" uses it: `approveGoal` (`goals-service.ts`) now sets `text_hash`
  and `approved_hash` to `liveTextHash` for every task of the goal whose `approved_hash` or
  `text_hash` differs from it (so re-approving corrects a stale `text_hash`); `findTask`
  (`tasks-router.ts`, so GET `/tasks/:id`) and `goalTasks` (`goals-service.ts`, GET
  `/goals/:id`) read the live hash into the row's `textHash`, so `wire.ts`'s unchanged
  `pinned` comparison agrees with ready and claim. `wire.ts` is not touched. New test "a task
  edited in the database reads unpinned until the goal is approved again, then is ready and
  claimable": GET and the goal's list say `pinned: false`, not ready, 409 `not_ready`; approve
  answers `pinned: 1`; then GET `pinned: true`, ready, claim 200. Acceptance `goals.test.ts`
  now passes 23/23 (it failed at line 263 before).
- Finding 2 (minor), fixed by a test rather than one definition: one definition is not
  possible here because the plan's spike rules out a generated column on PGlite and the app
  must hash before insert. The odd-strings test is replaced by "the SQL text hash equals
  taskTextHash over a wide sample": every ASCII character 1..127 in one string (each character
  escapes independently, so this covers all of them), U+0080, U+00FF, U+07FF, U+0800,
  U+2028/2029, U+FEFF, U+FFFF, CJK, an emoji, in titles, bodies, files and context refs, files
  null / [] / [""], and it compares the stored `text_hash` with `liveTextHash` row by row. Cost:
  the hash runs per candidate row on ready and claim, and once per row on GET; left as is (see
  Shortcuts).
- Finding 3 (minor), not changed. spec.md § Stories defines ready as pending, deps done,
  approved goal of the person, not held, pinned, in scope; it does not mention files, and the
  ticket says ready and claim share one eligibility condition so they never disagree. Filtering
  busy files out of ready would add a rule the spec does not have; a worker that gets 409
  `files_busy` moves to the next ready task. If the product owner wants ready to hide them, that
  is a spec change (I may not edit spec.md).

Extra file: apps/server/src/tasks/goals-service.ts - finding 1 needs approve to re-pin from the
live text (and the goal's task list to report `pinned` from it); approve lives only here.

**Proof (round 1, run fresh after the last edit)**
- Focused command: 3 files, 36 tests passed.
- `pnpm test`: shared 3 files / 30 tests, server 34 files / 423 tests, exit 0.
- `pnpm lint` exit 0 (eslint and prettier clean); `pnpm typecheck` exit 0.
- Not required: `pnpm exec vitest run --root plans/cloud-task-board/acceptance goals.test.ts`
  23 passed.

**Shortcuts taken (round 1)**
- `liveTextHash` is SHA-256 in SQL per row on ready, claim, GET task and GET goal. Fine for
  tens to hundreds of tasks per project; if ready gets slow, store a trigger-maintained hash
  (a trigger, not a generated column, is allowed on PGlite) and drop the recompute.

**For later tickets (round 1)**
- The previous note to 13 about `wire.ts`/`approveGoal` re-pinning is done here; nothing left
  for it. Any new code that decides `pinned` should compare against `liveTextHash`, or read the
  row through `findTask`.

## Review findings (round 1, pair review)

Reviewed c49a668cb05ccf8045f8fbc00722ebece4881b09..fb4b8a2 (END is HEAD, so there are no later commits). I read the ticket as it was at the base commit and did not see the Answer.

Hostile-caller inputs I probed:
- ready: `project_id`, `goal_id`, `limit`, and a run token's project.
- claim: path `:id` and body.
- headers: actor and device from the token, and the verb table for `/tasks/ready` and `/tasks/:id/claim`.
- concurrency: the advisory lock, the `FOR UPDATE` eligibility select and the conditional update.
- files: overlap with null or `[]` lists.
- lease: the boundary at `lte`/`gt` on expiry.

These held. Another workspace or project gets 404 (`resolveScope` plus `assertRunScope`). A device token or a token without the verb gets 403. A viewer gets 403. A body naming an actor or device is refused by the strict schema. Holder and device come only from the token. A refused claim writes nothing.

I ran the acceptance suite (`claim.test.ts`, `goals.test.ts`). Most failures are 404 on renew, done or release, which are ticket 07 routes. The `goals.test.ts` pinned-text failure is the problem in finding 1.

QUALITY
1. major apps/server/src/tasks/eligibility.ts: Eligibility now re-hashes the row's text in SQL (`approved_hash = <textHashSql>`). Nothing else uses that recomputed hash:
   - approve (`goals-service.ts` `approveGoal`) only re-pins rows where `approved_hash is distinct from text_hash`, and copies the stored `text_hash`.
   - the wire `pinned` flag (`wire.ts:96`) compares the stored columns.
   So a task whose text was changed directly in the database is stuck. GET reports it as `pinned: true`, while ready and claim refuse it as `not_ready`. Approving the goal again changes nothing, because the stale `text_hash` still equals `approved_hash`. The task can never be claimed again. The acceptance test `goals.test.ts` "a task whose text changed after approval ... until approved again" fails on this (`pinned` reads true at line 263, and the re-approve-then-claim step at 266-267 would also fail).
   Fix: make approve and the `pinned` flag use the same recomputed hash. For example, approve sets `text_hash` and `approved_hash` from `textHashSql` for every task of the goal, and `pinned` is computed from that same expression or written back. Add a test that edits the title in the database, approves again and claims.
2. minor apps/server/src/tasks/eligibility.ts: The canonical text hash is now defined twice, in `task-text.ts` (JSON.stringify) and in `textHashSql` (to_json). They have to stay byte-identical, or every pinned task becomes unclaimable. It also runs SHA-256 over every candidate row on every ready and claim. Keep a single definition, or add a test that checks both against each other on a wide sample of strings (the current test covers one string).
3. minor apps/server/src/tasks/ready.ts: The ready list still includes tasks whose files overlap a running live lease. A worker will keep pulling tasks that it then gets 409 `files_busy` on. Consider filtering them out, or document this in the spec.

REVIEW: FAIL

SPEC
- `pnpm --filter @sky-brain/server exec vitest run src/tasks/ready-claim.test.ts src/tasks/file-overlap.test.ts src/tasks/claim-isolation.test.ts` passes, covering every case listed under Tests: MET (conductor) for the run itself. I compared the tests with the Tests list and every case is covered. ready-claim.test.ts: ten `Promise.all` claims give one 200 and nine 409 already_claimed (bar 1). An unmet dependency is not ready and its claim is 409 not_ready (bar 2). Draft goals, cancelled goals, held goals, held tasks, unpinned tasks and a title changed in the DB after approval are never ready and their claim is 409 not_ready. P's device never gets Q's goal unless P is the assignee (bar 6). After 601 s the task reads pending and is ready again, the next claim has claim_seq 2 with events claimed/reclaimed/claimed, and attempts is 0. The test checks each event's actor, device and on_behalf_of against the token (bar 7). file-overlap.test.ts: a table of rule cases checked both ways (equal paths, folder prefix, backslash, trailing slash, null, [], and a prefix that is not a folder), plus a test that two overlapping tasks cannot both be in progress and the second claim is 409 files_busy (bar 5). claim-isolation.test.ts: workspace B (human, agent, run token) and run tokens of another project or workspace get 404 on ready and on claim (bar 4). A token without `claim` gets 403 verb_not_allowed.
- All existing tests still pass, and `pnpm lint` and `pnpm typecheck` exit 0: MET (conductor) for `pnpm test`, `pnpm lint` and `pnpm typecheck`.
- Acceptance (I ran it for claim.test.ts, run-tokens.test.ts and isolation.test.ts): 6 failed, 30 passed. All 6 failures are on ticket 07 routes. `/done` and `/release` return 404 "No such API route"; `/renew` returns 404 where 403 is expected. In claim.test.ts the 4 failures come after a successful claim, at the done or release call; the lease-expiry test fails where it expects 409 lease_lost from done. None of the failures is in ready or claim.
- scope: OK. The changed files are the 8 that `Touches` lists, plus plans/cloud-task-board/map.md (+1 row) and learnings.md (+1 entry, 06), which is the flow's own bookkeeping. Nothing touches renew, release, done or fail. END = fb4b8a2 = HEAD, so no later commits were left out.
- test first: OK. The test commit f714868 comes before the code commit fb4b8a2, and the conductor saw it fail. The new tests call routes that do not exist without the change (`/tasks/ready` would hit `/:id` and give 400), so they fail without the production code.

Notes: I did not read the `## Answer`; I read the ticket at c49a668. The ticket's Status changed from open to resolved. The level 3 the conductor gave is right for this change, so I am not raising it. The acceptance run may have left files behind (vitest cache); I have not looked for any.

REVIEW: PASS
