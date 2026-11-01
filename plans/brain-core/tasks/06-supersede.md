# Add the supersede route: agents propose replacements, people replace at once

Type: task
Status: open
Blocked by: 05
Test first: yes
Level: 3
Builder: backend
Touches: packages/shared/src/write.ts, apps/server/src/entries/

Text is never edited after approval; a change is a new entry that supersedes the old one (PLAN
sections 5 and 6). This ticket adds `POST /api/v1/entries/:id/supersede`.

`packages/shared/src/write.ts` (new in this plan): add `SupersedeInputSchema` (`{title, body, refs?, source?,
confidence?, kind?}`, same caps as post).

`apps/server/src/entries/supersede.ts` (new) and its route, added to the entries router (rate
limited like the other writes, before the schema check). The steps below run in the order of
spec.md Interfaces → Check order:
- The `:id` must be a uuid (`IdSchema`, else 400 `invalid_request`), then the request schema.
- Find the old entry through the caller's membership (404 `not_found` for another workspace's
  entry, and for an agent asking about a quarantined one).
- A viewer, or an agent acting for one, gets 403 `role_cannot_write`.
- The old entry must be in force: effective status `approved`, `proposed`, `open` or
  `answered`; otherwise 409 `not_in_force`.
- The new kind is the old kind; the only change allowed is claim → decision (promotion), else
  400 `kind_change_not_allowed`.
- Create the new entry with `createEntry` in the old entry's scope, with `supersedes` set, so
  every write rule applies (agent rules, workspace scope, viewers, secrets, quarantine, claim
  expiry, audit).
- An agent's replacement leaves the old entry exactly as it was (it stays in force until a person
  approves the new one). A human's replacement marks the old entry `superseded` in the same
  transaction, with a new `seq` and an `entry.status` audit row (`via: "supersede"`), unless the
  new entry was quarantined (then release does it later).
- 201 `{entry, old: {id, status}}`; `entry` carries `quarantined_because` like every entry.

Tests: an agent supersedes an approved human decision → the new one is `proposed`, the old one
is still `approved` with its old `seq`; a human supersedes an approved decision → the old one is
`superseded` with a higher `seq`; an agent superseding a rule → 403 `agent_cannot_write_rule`;
an agent superseding a workspace-scope entry → 403 `agent_cannot_write_workspace`; a human
superseding a superseded, rejected, expired or quarantined entry → 409 `not_in_force`, and an
agent superseding a quarantined one → 404; claim → decision
allowed, decision → note refused; a viewer superseding a superseded entry → 403
`role_cannot_write` (role before state); an agent superseding a superseded rule → 409
`not_in_force` (state before trust); a secret in the replacement → 422 and the old entry
untouched; a human's replacement whose body says "Ignore previous instructions" → 201 with
`entry.status` `quarantined` and `entry.quarantined_because` `ignore-instructions`, and the old
entry still in force; a non-uuid id → 400 `invalid_request`; a member of A superseding B's
entry → 404 and B unchanged.

## Not in this ticket

- Approving a replacement, which retires the old entry: the human routes ticket (07).
- Showing the supersede chain on `get`: the read ticket.

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/entries --reporter=verbose` passes, and the test
  names contain the `prints` lines of the check block below.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/entries --reporter=verbose
prints agent supersede of an approved decision stays proposed
prints old decision stays in force after an agent supersede
prints human supersede retires the old entry
prints refuses to supersede an entry that is not in force
prints a quarantined replacement names its pattern and leaves the old entry in force
prints cannot supersede an entry in another workspace
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Interfaces (Routes, Check order, Trust rules → status moves), § Edge cases
  (supersede rows)
- `apps/server/src/entries/write.ts` (new in this plan) (`createEntry`) from the post ticket

## Answer
