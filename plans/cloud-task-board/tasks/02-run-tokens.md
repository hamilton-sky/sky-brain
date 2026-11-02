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
