# Add owner-only workspace export and hard delete

Type: task
Status: open
Blocked by: 02, 03
Test first: yes
Level: 3
Builder: backend
Touches: packages/shared/src/workspace.ts, apps/server/src/workspaces/, apps/server/src/app.ts, docs/DECISIONS.md, docs/PLAN.md

PLAN section 10 asks for "export and hard delete for a whole workspace", the brief lists both as
human-only routes, and the user made both owner-only (spec.md Decisions, "Export and hard delete
are owner-only"). Delete loses data on purpose, so it needs the owner and a typed confirmation,
must touch nothing outside the one workspace, keeps every earlier audit row of the workspace (the
user's decision: the audit log stays strictly append-only), and adds a `workspace.delete` audit
row that outlives the workspace (spec.md Interfaces → Audit log).

`packages/shared/src/workspace.ts` (new): `DeleteWorkspaceInputSchema` (`{confirm: string}`,
required; any string passes the schema, the empty string included).

`apps/server/src/workspaces/` (new), mounted from its own router in `createApp`. Both routes run
the steps of spec.md Interfaces → Check order, in this order:
1. `requireHuman`: an agent → 403 `humans_only`, whatever the id and whatever its person's role.
2. The request shape: the `:id` must be a uuid (`IdSchema`), and for delete the body must match
   `DeleteWorkspaceInputSchema`; no JSON body, a missing `confirm` or a non-string one → 400
   `invalid_request`.
3. The workspace through membership: 404 `not_found` otherwise.
4. A human who is not an owner → 403 `owner_only`.
5. Delete only: a `confirm` that is not exactly the workspace's name → 400 `confirm_mismatch`.

- `GET /api/v1/workspaces/:id/export` → 200 the export document in spec.md Interfaces → Routes
  (`format: "sky-brain-export/1"`, the workspace, members, invites, projects, features, entries
  with their stored status and stored `quarantined_because`, and the audit log, oldest first),
  then writes a `workspace.export` audit row with `writeAudit`.
- `DELETE /api/v1/workspaces/:id` → in one transaction: delete the workspace (the schema's
  cascades remove its members, invites, projects, features and entries; `audit_log` has no
  foreign key, so the cascade never reaches it), then write the `workspace.delete` audit row
  (`workspace_id` and `target_id` the workspace id, the owner as actor, `details: {}`). No audit
  row is deleted or changed, and the append-only trigger from the database ticket stays exactly
  as it is. Then log one line naming the workspace id and the actor, and answer 204.

Tests: the owner exports and the document holds the seeded rows, and the export's own audit row
shows in a later export; an editor and a viewer → 403 `owner_only` on both routes, and a viewer
with a wrong `confirm` → 403 `owner_only` too; an agent acting for the owner → 403 `humans_only`,
and so does an agent using another workspace's id; the owner with no body, with `{}` and with
`{"confirm": 5}` → 400 `invalid_request`, and a viewer with no `confirm` → 400 `invalid_request`
(shape before role), each deleting nothing; the owner with a wrong `confirm` → 400
`confirm_mismatch`, every row left and no audit row added; a non-uuid id → 400 `invalid_request`;
the owner deletes workspace A and A's workspace, member, invite, project, feature and entry rows
are gone while workspace B's rows (its audit rows included) and every `devices` row are unchanged
(counted before and after); every audit row A had before the delete is still there and unchanged
(compared before and after), and exactly one `workspace.delete` row for A was added, with the
owner as actor; a human owner of A calling export or delete with B's id → 404 and B unchanged.

Docs: `docs/DECISIONS.md` gains two decisions (next free numbers), both made by the user: export
and hard delete are owner-only (rejected: any human writer), and a workspace delete keeps the
workspace's earlier audit rows, so the log stays strictly append-only (rejected: erasing them
through an exception in the append-only trigger). `docs/PLAN.md` section 10 gains one line
saying export and hard delete are for owners only, and that a delete keeps the workspace's audit
rows and adds a `workspace.delete` row.

## Not in this ticket

- Any way to delete or change an audit row: never; the user kept the log strictly append-only.
- Deleting a single entry: not asked for; entries are superseded or rejected instead.
- Invites and member management: the auth feature (T3).

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/workspaces --reporter=verbose` passes, and
  the test names contain the `prints` lines of the check block below.
- After a delete, every audit row the workspace had before it is still there, unchanged, and one
  `workspace.delete` row was added (asserted in a test).
- `docs/DECISIONS.md` records the two decisions with their rejected options, and `docs/PLAN.md`
  section 10 says what a delete leaves.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/workspaces --reporter=verbose
prints owner exports the whole workspace
prints only an owner can export or delete
prints agent cannot export or delete
prints missing confirm is an invalid request
prints wrong confirm deletes nothing
prints deleting a workspace leaves other workspaces unchanged
prints deleting a workspace keeps its earlier audit rows
prints deleting a workspace leaves a workspace.delete audit row
prints cannot export or delete another workspace
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Interfaces (Routes → export document, Check order, Audit log), § Stories (an owner
  takes a workspace out, or deletes it), § Edge cases (delete rows), § Decisions (the audit log
  outlives the workspace row; a workspace delete keeps the earlier audit rows; export and hard
  delete are owner-only; a missing `confirm` is a bad request, a wrong one a mismatch)
- docs/PLAN.md section 10 (update it)
- `apps/server/src/db/schema.ts` (new in this plan) and the `audit-append-only` custom migration
  from the database ticket; `apps/server/src/db/audit.ts` (new in this plan, `writeAudit`);
  `requireHuman` and `IdSchema` from the actor ticket

## Answer
