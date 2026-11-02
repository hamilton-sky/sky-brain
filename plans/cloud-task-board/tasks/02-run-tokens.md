# Mint run tokens with verbs, and resolve them to an agent actor with a device

Type: task
Status: open
Blocked by: 01
Test first: yes
Level: 3
Builder: backend
Touches: apps/server/src/run-tokens/, apps/server/src/actor/run-context.ts, apps/server/src/actor/run-context.test.ts, apps/server/src/db/auth-schema.ts, apps/server/drizzle/, apps/server/src/app.ts, apps/server/src/app.test.ts, apps/server/src/testing/task-seeds.ts, packages/shared/src/run-tokens.ts

Repo: sky-brain. Second half of T7, server side, and D8: run tokens of at most 30 minutes bound
to a device, workspace, project, role and verbs (spec.md § Stories "A machine gets short-lived
run tokens", § Check order steps 1 and 3). Needs ticket 01's device credential and
`secret-token.ts`.

- `runTokens` table in `apps/server/src/db/auth-schema.ts` (new in ticket 01): id, token_hash unique, device_id
  (FK devices, cascade), workspace_id, project_id (composite FK to `projects (id,
  workspace_id)` like `entries_project_in_workspace_fk`), role (`editor` | `viewer`), verbs
  (text array), expires_at, created_at. Generate the migration.
- `apps/server/src/actor/run-context.ts` (new): `RunContext = { kind: "device" | "run";
  deviceId; tokenId; workspaceId?; projectId?; role?; verbs }`, a `WeakMap<Request,
  RunContext>`, `setRunContext` and `runContextOf(req): RunContext | undefined`. The `Actor`
  union in `packages/shared/src/actor.ts` does not change.
- `apps/server/src/run-tokens/resolver.ts` (new): `runTokenResolver(db, now)` returns an
  `ActorResolver`. A bearer token starting `sbd_` or `sbr_` is looked up by hash, joined to its
  device; unknown, expired (`expires_at <= now`) or revoked device → throw `HttpError(401,
  "invalid_token")`, never fall through. Found → the actor `{kind: "agent", agent_id:
  "device/<device_id>", on_behalf_of: <devices.user_id>}` and the run context. Any other bearer
  token → `undefined` so the next resolver runs. In `createApp`, chain it before
  `options.resolveActor` (`run token, then the existing resolver`).
- `apps/server/src/run-tokens/verbs.ts` (new): the table of method and path pattern to verb for
  every route in spec.md § Routes, written in full now so the later route tickets need not edit
  it (`read`, `plan`, `claim`, `report`; a device token only `POST
  /api/v1/run-tokens`), and middleware mounted on `/api/v1` right after `express.json`: a
  request with a run context whose verbs do not cover its method and path, or whose path is not
  in the table, gets 403 `verb_not_allowed`. Brain-core's entries routes are deliberately not in
  the table (spec.md § Scope).
- `apps/server/src/run-tokens/mint-router.ts` (new): `POST /api/v1/run-tokens` (device token
  only; a run token or any other caller gets 403 `verb_not_allowed` or `humans_only` as the
  check order gives). Body `{project_id, verbs (1..4, unique), role?, ttl_seconds? (60..1800,
  default 1800)}`, strict. The project's workspace must have a `members` row for the device's
  person (else 404); role defaults to `editor` for an owner or editor and `viewer` for a
  viewer; a viewer asking `editor` gets 403 `role_too_high`. Sets `devices.last_seen_at`, writes
  a `run_token.mint` audit row (details: device id, verbs, role, ttl; never the token).
- `apps/server/src/run-tokens/run-scope.ts` (new): `assertRunScope(req, { workspaceId,
  projectId })` → 404 `not_found` when a run token's workspace or project differs, and
  `effectiveRole(req, memberRole)` → the lower of the token's role and the member's role. The
  task routes (tickets 04-07) call both.
- `packages/shared/src/run-tokens.ts` (new): the one definition of the verbs,
  `VERBS = ["read", "plan", "claim", "report"] as const`, `Verb = (typeof VERBS)[number]`
  and a zod `verbSchema`, plus the strict mint request schema. The server's verb table, the mint
  route, `task-seeds.ts` and every later ticket import `Verb` from here (CLAUDE.md: shared types
  are not copied).
- `mintRunToken` in `apps/server/src/testing/task-seeds.ts` (new in ticket 01).

Tests (`apps/server/src/run-tokens/run-tokens.test.ts`, new; until ticket 04 lands, prove
`verb_not_allowed` and project binding with a tiny test-only router mounted in the test file):
mint as owner, editor and viewer; expired run token 401; a revoked device's run token and
device token 401; a token without `claim` calling a `claim` route 403 `verb_not_allowed`; a
device token calling anything but mint 403; `POST /api/v1/entries` with any run token 403; a
token for project A gets 404 from `assertRunScope` for project B in the same workspace; a body
naming `device_id` or `workspace_id` on mint is 400 `invalid_request`.

## Not in this ticket

- Checking `verb`, `assertRunScope` and `effectiveRole` in the goal and task routes: tickets
  04-07 call them.
- Run tokens on brain-core's entries routes: round two (R2-08).
- The `pathly brain login` client and Pathly's run-token client: the pathly-adapters follow-up
  plan (map.md § Follow-up: Pathly client).

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/run-tokens src/actor/run-context.test.ts`
  passes, covering every case listed under Tests (bar property 8).
- All existing tests still pass (the harness's own bearer tokens still resolve), and
  `pnpm lint` and `pnpm typecheck` exit 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/run-tokens src/actor/run-context.test.ts
prints passed
$ pnpm test
$ pnpm lint
$ pnpm typecheck
```

## Reference

- spec.md § Stories, § Routes, § Check order, § Decisions (opaque tokens, the verb table)
- `docs/DECISIONS.md` D8; `docs/layer-1/TICKETS.md` T7
- `apps/server/src/actor/middleware.ts`, `apps/server/src/actor/keys.ts`,
  `apps/server/src/scope/resolve-scope.ts` (read-only)

## Answer

Work started at `b1dfe0f9a8eff3baf1381e04873316339181a9fd`. Round 2: `e0ce4b9` restores every path
outside the plan folder to that base; `42ffc8b` adds the test files alone (they fail on the missing
`actor/run-context.ts` and `run-tokens/*` modules); the next commit restores the code.

**Built**
- New: `packages/shared/src/run-tokens.ts` (`VERBS`, `Verb`, `verbSchema`, `RUN_TOKEN_ROLES`,
  `RunTokenRole`, ttl bounds, strict `RunTokenMintRequestSchema`);
  `apps/server/src/actor/run-context.ts`; `apps/server/src/run-tokens/resolver.ts`, `verbs.ts`,
  `mint-router.ts`, `run-scope.ts`; migration `apps/server/drizzle/0004_run-tokens.sql`
  (+ `meta/0004_snapshot.json`, `_journal.json`, from `drizzle-kit generate --name run-tokens`).
- Tests: `apps/server/src/run-tokens/run-tokens.test.ts` (mint, resolver), `verbs.test.ts` (verb
  table, verbs over HTTP, project binding, effective role), `tests/fixture.ts` (shared setup and the
  test-only app/router), `apps/server/src/actor/run-context.test.ts`.
- Changed: `apps/server/src/db/auth-schema.ts` (`runTokens`), `apps/server/src/app.ts` (resolver
  chain, `verbMiddleware()` after `express.json`, `/api/v1/run-tokens` mount),
  `apps/server/src/testing/task-seeds.ts` (`mintRunToken`).

**Proof**
- `pnpm --filter @sky-brain/server exec vitest run src/run-tokens src/actor/run-context.test.ts`:
  4 files, 24 tests passed, exit 0. Cases: mint as owner (editor role, 1,800 s, only the hash
  stored, `last_seen_at`, `run_token.mint` audit without the token), editor (ttl 60), viewer
  (default viewer; `editor` 403 `role_too_high`); outsider and unknown project 404; body with
  `device_id` / `workspace_id` (and bad verbs, role, ttl, project id) 400 `invalid_request`;
  expired run token 401 `invalid_token` from exactly `expires_at`; revoked device's run token and
  device token 401; unknown `sbr_`/`sbd_` 401; token without `claim` on a claim route 403
  `verb_not_allowed` (real app and test router) and with `claim` 200 on the test router; device
  token on everything but mint 403; `POST /api/v1/entries` with an all-verbs run token 403; token
  for project A 404 from `assertRunScope` for project B (same workspace) and C (other workspace);
  `effectiveRole` lower of token and member role; harness bearer tokens still resolve.
- `pnpm test`: shared 2 files / 15 tests, server 22 files / 318 tests, exit 0 (re-run in round 2).
- `pnpm lint` exit 0; `pnpm typecheck` exit 0.
- Not required: acceptance `run-tokens` 22 of 31 with `device-login` pass; the 9 failures all
  stop at creating a goal (404, tickets 04-07).

**Decisions**
- `run_tokens.role` is `text` with a check `in ('editor','viewer')`, not schema.ts's `role` enum:
  `auth-schema.ts` is loaded while `schema.ts` is still evaluating (it re-exports it), so
  `roleEnum` is undefined at table-build time (drizzle-kit crashed). `devices`/`projects` work
  only because they are referenced inside callbacks.
- A person (or any non-device agent) calling `POST /api/v1/run-tokens` gets 403
  `verb_not_allowed` ("Only a device token can mint"): the spec's check order has no better code,
  and `humans_only` would mean the opposite.
- The verb table lives in `verbs.ts` with `verbFor(method, path)` exported; `mint` is a pseudo-verb
  only a device token has. `:id` matches one non-empty segment; literals compare lower-cased
  (Express routes ignore case) and one trailing slash is dropped (Express is non-strict); anything
  else, including `HEAD`, is not in the table and refused. Human-only routes (approve, cancel,
  release, release-text) and devices routes are left out, so a run token gets 403
  `verb_not_allowed` there before `humans_only` (step 3 before 4).
- `assertRunScope` also 404s a device-kind context (bound to no project), so it fails closed if a
  device token ever got past the verb table. A request without a run context passes.
- Mint re-checks the device inside its transaction (`UPDATE devices SET last_seen_at ... WHERE
  revoked_at IS NULL RETURNING`), so a revoke between resolve and mint mints nothing (401).
- Mint audit details: `on_behalf_of`, `device_id`, `project_id`, `verbs`, `role`, `ttl_seconds`.
- The resolver does not touch `last_seen_at` on every request; only mint does (as the ticket says).

**Review fixes**
- Round 1, test first ("no commit between base and HEAD changes only test files"): the old test
  commit `8703472` held `run-tokens/test-fixture.ts`, which the guard's test-file pattern does not
  match. Recovered without rewriting history: `e0ce4b9` backs out the build (tree equals `b1dfe0f`
  outside `plans/`), `42ffc8b` commits only `run-context.test.ts`, `run-tokens.test.ts`,
  `verbs.test.ts` and the fixture moved to `run-tokens/tests/fixture.ts` (a `tests/` folder matches
  the pattern; Vitest does not collect it since it is not `*.test.ts`); at `42ffc8b` the focused
  run fails 3 files on `Cannot find module '../../actor/run-context.ts'`. The code commit then
  restores the production files from `0d99995` unchanged. Re-proved: focused run 4 files / 24 tests
  passed; `pnpm test` (15 + 318), `pnpm lint`, `pnpm typecheck` exit 0.

**Shortcuts taken**
- No general per-actor rate limit on mint (Check order step 5): no general limiter is mounted in
  the app yet (as in ticket 01). A device can mint as fast as it can call; each mint is one row.
  Worth adding with the first ticket that mounts the general limiter.
- Expired `run_tokens` rows are never purged. At one mint per 30 minutes per worker the table
  grows slowly; add a purge (like device codes') if it ever matters.
- No migration test that old rows survive 0004: it only creates a new table.

**For later tickets**
- 04-07: call `assertRunScope(req, { workspaceId, projectId })` after loading the target, and
  `effectiveRole(req, memberRole)` before the role check; `runContextOf(req)?.deviceId` is the
  device for task events (null for people). The verb table already lists every route of spec.md
  Routes; mount routers after `verbMiddleware()` (which is in the `/api/v1` chain in `app.ts`).
  `GET /api/v1/tasks/ready` with a run token may omit `project_id`: take it from
  `runContextOf(req).projectId`.
- Tests can reuse `run-tokens/tests/fixture.ts` (`useRunTokenFixture`, `world`, `device`) and
  `mintRunToken` from `testing/task-seeds.ts`.
- `db/schema.test.ts` still lists 9 tables (outside this ticket's Touches); `run_tokens` exists
  but is not in that list.


## Review findings (round 1, test first)

no commit between base and HEAD changes only test files. Commit the failing test alone first, then the code. A test commit does not count when earlier commits already changed production files. If the test and the code are in one commit (or the test commit sits on top of code that is already there), recover: revert that commit, commit the test files alone, then restore the production files in a later commit (git checkout <the old commit> -- <paths>). Do not rewrite history.

## Review findings (round 2, pair review)

Review range: b1dfe0f9a8eff3baf1381e04873316339181a9fd..500257a46f5d3aac27d45a98fe09703be9b09f26. That is the newest commit touching the ticket, and it is also HEAD, so no later commits were left out. I did not read the ticket's `## Answer`. I re-ran `pnpm --filter @sky-brain/server exec vitest run src/run-tokens src/actor/run-context.test.ts`: 4 files and 24 tests passed. The working tree stayed clean. I also ran the run-tokens acceptance file. 9 of its 16 tests fail, and every one fails in `createGoal` with 404 "No such API route.", because `/api/v1/goals` belongs to ticket 04. None of the failures comes from the mint, resolver or verb code.

Inputs I probed as a hostile caller:
- The Authorization header: scheme case, spacing, `sbd_`/`sbr_` prefixes, unknown, expired and revoked tokens.
- X-Dev-Actor together with a token.
- Method and path through the verb table: case, trailing slash, `//`, encoded segments, HEAD, the human-only goal and task routes, `/devices`, `/entries`.
- The mint body: `project_id`, verbs, role, `ttl_seconds`, and extra fields `device_id` and `workspace_id`.
- Minting into a project of a workspace where the person is not a member.
- A device revoked between resolve and mint.
- Role raise from viewer to editor.
- How often a device can mint, and how many rows that leaves.

Only the mint rate is a way through. The verb table fails closed, the revoke race is covered inside the transaction, strict bodies refuse unknown fields, and membership is checked by join.

QUALITY
1. major apps/server/src/run-tokens/mint-router.ts (and apps/server/src/app.ts): `POST /api/v1/run-tokens` has no rate limit, and nothing ever deletes expired `run_tokens` rows. spec.md Check order step 5 rate-limits every POST under `/api/v1` per actor and device. Ticket 04's `createRateLimiter()` covers only board writes, so mint stays unlimited even after that ticket lands. Anyone holding a device token, leaked or buggy, can mint without limit. Each call writes a `run_tokens` row and a `run_token.mint` audit row, so the database grows without bound until a person revokes the device. Ticket 01 had the same kind of unbounded insert and it was rated major there. Fix: put a `createRateLimiter` keyed on `actorKey(actor)` plus the device id in front of mint. Also delete the device's expired run tokens inside the mint transaction, or purge them some other way.
2. minor apps/server/src/run-tokens/resolver.ts: `bearerOf` matches only `Bearer` in that exact case with a single space. HTTP treats the scheme name as case-insensitive, so a revoked or expired `sbr_`/`sbd_` token sent as `bearer sbr_…` skips the 401 `invalid_token` and falls through to the next resolver. The spec says these tokens never fall through. Fix: match `/^Bearer\s+(\S+)\s*$/i`.
3. minor apps/server/src/run-tokens/verbs.ts: `verbFor` knows only GET, not HEAD. Express serves HEAD with the GET handler, so a run token with `read` gets 403 on `HEAD /goals`. This fails closed and is harmless, but it is inconsistent. Fix: map HEAD to GET in `verbFor`, or leave it and write down that it is refused on purpose.

REVIEW: FAIL

Notes: I reviewed b1dfe0f..500257a. 500257a is the newest commit that touches the ticket, and it is also HEAD, so there are no later commits left out. I read the ticket as it was at b1dfe0f. The round-1 review findings sit after `## Answer` in the working copy, so I read them with `sed -n '184,$p'` and did not read the Answer. The Answer did not reach me. I ran the acceptance file `run-tokens.test.ts` myself: 7 tests pass and 9 fail. All 9 fail inside `createGoal` (`POST /api/v1/goals` returns 404). The goal routes belong to ticket 04, so none of these failures is about what this ticket delivers. My runs left no files behind (`git status` is clean).

Spec check against the ticket: `run_tokens` table and migration 0004 (hash unique, device FK cascade, composite project/workspace FK, role check, verbs text[]); `run-context.ts` WeakMap; resolver for `sbd_`/`sbr_` (401 `invalid_token` for unknown, expired at `<=` now, or revoked device; any other bearer token returns undefined) chained before `options.resolveActor`; full verb table plus middleware right after `express.json`, failing closed; mint router (strict body, 404 when the person is not a member, role defaults and `role_too_high`, `last_seen_at`, audit row without the token); `assertRunScope` and `effectiveRole`; shared `VERBS`, `Verb`, `verbSchema` and mint schema; `mintRunToken` in task-seeds. All are present and match the ticket. The unit tests cover every case listed under Tests.

SPEC
- `pnpm --filter @sky-brain/server exec vitest run src/run-tokens src/actor/run-context.test.ts` passes, covering every case under Tests: MET (conductor). Test names cover: mint as owner, editor and viewer; expired 401; revoked device's run and device tokens 401; missing `claim` 403 `verb_not_allowed`; device token 403 on anything but mint; `POST /api/v1/entries` with a run token 403; `assertRunScope` 404 for project B; `device_id`/`workspace_id` in the body 400 `invalid_request`.
- All existing tests still pass (`pnpm test`): MET (conductor)
- `pnpm lint` exits 0: MET (conductor)
- `pnpm typecheck` exits 0: MET (conductor)
- scope: OK. Every changed file is under the ticket's Touches (`run-tokens/`, including `run-tokens/tests/fixture.ts`; `actor/run-context*`; `db/auth-schema.ts`; `drizzle/`; `app.ts`; `testing/task-seeds.ts`; `packages/shared/src/run-tokens.ts`). The rest is the flow's own records: `plans/cloud-task-board/map.md`, `learnings.md` and the ticket.
- test first: OK. 42ffc8b adds only test files (`run-context.test.ts`, `run-tokens.test.ts`, `verbs.test.ts`, `tests/fixture.ts`) on top of e0ce4b9, which reverted all production code, so this fixes the round-1 finding. The conductor saw 42ffc8b fail the Test command before the code was added. 500257a adds only production code.

REVIEW: PASS
