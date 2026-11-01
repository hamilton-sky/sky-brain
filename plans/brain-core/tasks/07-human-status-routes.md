# Add the human-only approve, reject, release and answer routes

Type: task
Status: open
Blocked by: 06
Test first: yes
Level: 3
Builder: backend
Touches: packages/shared/src/human.ts, apps/server/src/entries/

People hold the top authority: only a human owner or editor moves an entry's status. This
ticket adds the four status routes of T4 and the side effects in spec.md Interfaces → Trust
rules → Status moves.

`packages/shared/src/human.ts` (new): `AnswerInputSchema` (`{body, title?, refs?}`, the post
caps; the default title is `Re: ` plus the question's title, cut to 200 characters).

`apps/server/src/entries/status.ts` (new) and `routes-human.ts` (new), added to the entries
router (not `app.ts`), all rate limited:
- Every route runs the steps of spec.md Interfaces → Check order in order: `requireHuman` first
  (an agent → 403 `humans_only`, whatever the id and whatever its person's role), then the rate
  limiter, then the request schema (the `:id` a uuid, `IdSchema`), then the entry through
  membership (404 otherwise), then a viewer → 403 `role_cannot_write`, then the state checks
  below.
- `POST /api/v1/entries/:id/approve`: effective status must be `proposed` (an expired claim →
  409 `expired`; anything else → 409 `invalid_state`). It becomes `approved`; a claim's
  `expires_at` is cleared. If it supersedes X: X already `superseded` → 409
  `already_superseded` and nothing changes; X in force → X becomes `superseded`. An approved
  answer marks its open question `answered`. 200 `{entry, superseded}`.
- `POST /api/v1/entries/:id/reject`: from `proposed`, `quarantined` or `open` to `rejected`,
  else 409 `invalid_state`. A rejected answer reopens its question when no other approved or
  proposed answer remains. 200 `{entry}`.
- `POST /api/v1/entries/:id/release`: from `quarantined` to the status the trust function gives
  for the entry's kind and author kind, else 409 `invalid_state`; then the write-time side
  effects run (a human's replacement retires its old entry; an answer marks its question). 200
  `{entry}`.
- `POST /api/v1/entries/:id/answer`: the target must be a question that is `open` or `answered`
  (else 409 `invalid_state`); creates the answer with `createEntry` (`kind: "answer"`,
  `reply_to`, the question's scope, so secrets and quarantine apply). 201 `{answer, question}`;
  `answer` carries `quarantined_because` like every entry.
- Every change happens in one transaction, gives each changed entry a new `seq` and
  `updated_at`, and writes an `entry.status` audit row (`details: {from, to, via}`).

Tests: an agent calling each of the four routes → 403 `humans_only`, including an agent acting
for a viewer and an agent using another workspace's entry id; a human viewer → 403
`role_cannot_write`; an owner
approves an agent's proposed decision that supersedes an approved one → the new one `approved`,
the old one `superseded` (bar 2's second half); approving the second of two competing
replacements → 409 `already_superseded`, nothing changed; approving an expired claim → 409
`expired`; approving a claim clears `expires_at`; reject and release from each allowed and one
refused status; releasing a quarantined human decision → `approved`, a quarantined agent claim →
`proposed`; answering an open question → answer `approved`, question `answered`; rejecting
that answer → question `open`; an answer whose body says "Ignore previous instructions" → 201
with `answer.quarantined_because` `ignore-instructions` and the question as it was, and once
released its `quarantined_because` is `null`; a human with a non-uuid id → 400
`invalid_request`; every change has its audit row; a human owner of A calling each route on B's
entry → 404 and B unchanged.

## Not in this ticket

- Export and workspace delete, the other human-only routes: a separate ticket.
- Supersede itself: the supersede ticket (06).

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/entries --reporter=verbose` passes, and the test
  names contain the `prints` lines of the check block below.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/entries --reporter=verbose
prints agent cannot approve
prints agent acting for a viewer gets humans_only
prints approving a replacement retires the old decision
prints refuses to approve a replacement whose target is already superseded
prints release gives a quarantined entry its write-time status
prints rejecting the only answer reopens the question
prints a quarantined answer names its pattern
prints cannot change the status of an entry in another workspace
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Interfaces (Routes, Check order, Trust rules → Status moves, Audit log), § Stories
  (a person keeps the top authority), § Edge cases (approve, release, reject rows)
- `apps/server/src/entries/write.ts` (new in this plan), `apps/server/src/entries/supersede.ts`,
  `apps/server/src/entries/trust.ts` (new in this plan) from the earlier entries tickets

## Answer
