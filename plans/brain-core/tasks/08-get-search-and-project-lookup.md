# Add get, search and project lookup, each filtered by membership

Type: task
Status: open
Blocked by: 02, 03
Test first: yes
Level: 3
Builder: backend
Touches: packages/shared/src/read.ts, apps/server/src/reads/, apps/server/src/projects/, apps/server/src/app.ts

The read side of T4: `GET /api/v1/entries/:id`, `GET /api/v1/entries` (search) and
`POST /api/v1/projects/lookup`. Every query carries the membership filter in the same SQL
statement (CLAUDE.md hard rule 4), and agents never see quarantined text. Tests insert entries
with `seedEntry`, so this ticket does not wait for the write routes.

`packages/shared/src/read.ts` (new): `SearchQuerySchema` (exactly one of `workspace_id`,
`project_id`, `feature_id`; `q` up to 500 characters; `kind` and `status` as comma lists of
known values; `since` a non-negative integer; `limit` 1..100, default 20) and
`LookupInputSchema` (`{workspace_id, git_remote}`).

Each route runs the steps of spec.md Interfaces → Check order that apply to it, in order: the
request shape (including `invalid_remote`) before the membership lookup.

`apps/server/src/reads/` (new), mounted from its own router in `createApp`:
- `GET /api/v1/entries/:id` → 200 `{entry, supersedes, superseded_by, answers}`: `supersedes`
  walks the `supersedes` chain back (nearest first, bounded at 50), `superseded_by` lists the
  entries whose `supersedes` is this id, `answers` the entries whose `reply_to` is this id. A
  non-uuid id → 400 `invalid_request` (`IdSchema`); an id outside the caller's workspaces →
  404. For an agent, a quarantined entry is 404 and quarantined entries are dropped from the
  three lists.
- `GET /api/v1/entries?...` → 200 `{entries}` over the scope's subtree (spec.md Interfaces →
  Routes), `q` through `websearch_to_tsquery('english', q)` (as a bound parameter; it never
  raises a syntax error, map.md full-text search line) on the `search` column, `kind` and
  `status` filters on the effective status (so `status=expired` finds expired claims), and the
  order rules in the spec (`since` → `seq` ascending). Agents never get quarantined entries,
  even when they ask for `status=quarantined`.
- Entries are rendered with `toWireEntry(row, now)`, so each carries `quarantined_because`.

`apps/server/src/projects/` (new): `POST /api/v1/projects/lookup` normalizes `git_remote` with
`normalizeGitRemote` (null → 400 `invalid_remote`), finds the project in that workspace through
membership (unknown remote or non-member → 404 `not_found`), and returns `{project, features}`.
A POST, not a GET, so a remote with credentials never sits in a URL.

Tests: get returns the chain and answers; an agent gets 404 for a quarantined entry, a human
gets it with its `quarantined_because`, and a clean entry's is `null`; a non-uuid id → 400;
search by a stemmed word, by kind, by status (including `expired`), with `since` (ascending,
only higher seqs) and limit; search on a project includes its features' entries and
not the workspace's; lookup with the https, scp-like, credentialed and `.git` forms of one
remote returns the same project; a bad remote → 400; and, for each of the three routes, a
member of workspace A using workspace B's entry id, scope id or remote gets 404 (search: no B
entry, ever).

## Not in this ticket

- The context packet, which also reads the chain: a separate ticket.
- Writing entries: the post, supersede and human routes tickets.
- Creating projects and features: out of this feature.

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/reads src/projects --reporter=verbose`
  passes, and the test names contain the
  `prints` lines of the check block below.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/reads src/projects --reporter=verbose
prints get returns the supersede chain and answers
prints hides a quarantined entry from an agent
prints search finds an entry by a stemmed word
prints search with since returns only newer seqs
prints lookup finds the project from any form of its remote
prints cannot read another workspace through get
prints cannot read another workspace through search
prints cannot read another workspace through lookup
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Interfaces (Routes, Check order, Wire types, Git remote normalization), § Stories
  (workspaces stay apart, find a project), § Edge cases (search and remote rows)
- `apps/server/src/db/entries-view.ts` (new in this plan), `apps/server/src/scope/`, `packages/shared/src/git-remote.ts`

## Answer
