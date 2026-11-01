# Resolve the actor, the scope and membership for every /api/v1 request

Type: task
Status: resolved
Blocked by: 02
Test first: yes
Level: 3
Touches: packages/shared/src/actor.ts, packages/shared/src/scope.ts, apps/server/src/actor/, apps/server/src/scope/, apps/server/src/http/, apps/server/src/app.ts, apps/server/src/app.test.ts, apps/server/src/config.ts, apps/server/src/config.test.ts, apps/server/src/server.ts, apps/server/src/testing/harness.ts, apps/server/src/testing/harness.test.ts, docs/DECISIONS.md, docs/PLAN.md

Identity in this feature comes from a pluggable actor, never from a request body (CLAUDE.md hard
rule 2). This ticket builds that layer and the scope check every route will use.

`packages/shared/src/actor.ts` (new): the zod `ActorSchema` and `Actor` type from spec.md
Interfaces (human `{kind, user_id}`, agent `{kind, agent_id, on_behalf_of}`, with the id
formats given there). `packages/shared/src/scope.ts` (new): `ScopeRefSchema`, exactly one of
`workspace_id`, `project_id`, `feature_id` (uuids), and `IdSchema` (a uuid) for path `:id`s:
every later route with an `:id` checks it with `validate(IdSchema, ...)` at step 5 of spec.md
Interfaces → Check order, so a non-uuid id is 400 `invalid_request`, never a database error.

`apps/server/src/actor/` (new):
- `type ActorResolver = (req) => Actor | undefined | Promise<Actor | undefined>`.
- The actor middleware for `/api/v1`: when the request carries `X-Dev-Actor`, then if the dev
  header is on, parse it with `ActorSchema` (invalid → 401 `invalid_dev_actor`); if it is off,
  refuse with 401 `dev_actor_disabled` whatever else the request carries. Otherwise call the
  resolver. No actor → 401 `unauthenticated`. The actor is attached to the request for routes.
- `actorKey(actor)` for the rate limiter: `human:<user_id>` or
  `agent:<agent_id>:<on_behalf_of>`; `auditActor(actor)` for `writeAudit`: the `actor` string
  `human:<user_id>` or `agent:<agent_id>`, plus `{on_behalf_of}` for the details of an agent.
- `requireHuman`: route middleware that answers 403 `humans_only` to an agent actor, before any
  lookup (step 3 of spec.md Interfaces → Check order). The human-only status routes and the
  workspace routes put it first on each of their routes.

`apps/server/src/config.ts` (new in this plan): `devActorHeaderEnabled(env)` returns true only when `NODE_ENV` is
exactly `"development"` (unset, `test` and `production` are off). `start` passes it to
`createApp` and, when it is on, listens on `127.0.0.1` only.

`apps/server/src/http/` (new): `HttpError(status, code, message, extra?)` and the four-argument
error middleware that renders `{"error": {code, message, field?, rule?}}`; body-parser errors
map to 400 `invalid_json` and 413 `too_large`; anything else is 500 `internal` with no stack in
the body. A `validate(schema, value)` helper that turns a zod failure into 400
`invalid_request` (the size caps' 413 is the post ticket's, which owns those schemas).

`apps/server/src/scope/` (new): `resolveScope(db, actor, ref)` returns `{ workspaceId,
projectId, featureId, level: "workspace" | "project" | "feature", role }`, deriving the chain
from the one id given and checking that the human, or the person the agent acts for, has a
`members` row in that workspace, in the same query. Unknown id, or not a member → 404
`not_found`. `memberRole(db, workspaceId, actor)` for routes that start from an entry id.

`apps/server/src/app.ts` (new in this plan): `createApp` takes `{ db, resolveActor?,
devActorHeader?, now?, webDist? }` (`now` defaults to `() => new Date()` and is passed to routes
later), and mounts, on `/api/v1` and in this order, the actor middleware and then
`express.json({ limit: "64kb" })`, so an anonymous request is refused before its body is read
(steps 1 and 2 of spec.md Interfaces → Check order); the error middleware goes last.
`server.ts` passes the database opened at start.

`apps/server/src/testing/harness.ts` (new in this plan): add `startTestServer` and the `TestServer`,
`TestClient` and `TestResponse` shapes as spec.md Interfaces → How a test reaches the server
says, except its `rateLimit` option, which arrives with the rate limiter in a later ticket.
`as(actor)` carries the actor to the resolver through an opaque `Authorization: Bearer
<random>` value the harness maps back (so tests use the same header real tokens will);
`anonymous` sends none.

Tests (allowed and refused cases, CLAUDE.md "a change to permissions or trust rules needs a
test for the allowed case and for the refused case"; the HTTP ones go under `src/actor/`, so the
check block's filter runs them): no actor → 401; dev header on with a
valid actor → passes the middleware (an unknown `/api/v1` path then answers 404); dev header
off → 401 `dev_actor_disabled` even with a valid bearer actor; malformed dev header → 401
`invalid_dev_actor`; `devActorHeaderEnabled` for `development`, `production`, `test` and unset;
`resolveScope` for a member at each level, a viewer (role returned), a non-member (404), a
missing id (404) and an agent acting for a member; malformed JSON → 400; a 70 KB body → 413;
an anonymous request with malformed JSON → 401, not 400 (the actor comes first);
`requireHuman` passes a human and answers an agent 403 `humans_only`; `validate(IdSchema, ...)`
(tested under `src/scope/`) passes a uuid and answers `not-a-uuid` with 400 `invalid_request`.

Docs: `docs/DECISIONS.md` gains a decision (next free number) for the dev actor header: what it
is, the allow-list on `NODE_ENV=development`, 127.0.0.1, refused loudly otherwise, and that the
auth feature replaces it. `docs/PLAN.md` section 9 gains one line saying so.

## Not in this ticket

- Any entries route: the entries tickets that follow.
- The rate limiter: the guards ticket builds it and the post ticket wires it.
- Real authentication (sessions, OAuth, run tokens): the auth feature.

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/actor src/scope src/config --reporter=verbose`
  passes, and the test names contain the
  `prints` lines of the check block below.
- `GET /healthz` still answers 200 without an actor, and `node tools/dev-smoke.mjs` prints
  `healthz 200`.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/actor src/scope src/config --reporter=verbose
prints refuses a request with no actor
prints refuses the dev header when it is off
prints refuses a malformed dev header
prints accepts the dev header in development
prints checks the actor before the body
prints refuses an agent on a humans-only route
prints hides a workspace the caller is not a member of
prints refuses an id that is not a uuid
$ node tools/dev-smoke.mjs
prints healthz 200
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Interfaces (How a test reaches the server, Dev actor header, Wire types → errors,
  Check order), § Edge cases (the 401, 400, 404 and 413 rows), § Decisions (dev header, scope
  as one id, one check order)
- CLAUDE.md hard rules 2 and 4 (read-only)
- `apps/server/src/testing/harness.ts` (new in this plan) from the database ticket

## Answer

Work started at commit `95c910f4acbf5551c5a1959d5129692162ad222c`. The test-only commit is
`616996b test(brain-core): 03 failing test` (it failed on the missing modules,
`devActorHeaderEnabled is not a function` and a 404 where 401 was expected).

**Built**
- `packages/shared/src/actor.ts`: `UserIdSchema`, `AgentIdSchema`, `ActorSchema` (a
  discriminated union on `kind`) and `Actor`.
- `packages/shared/src/scope.ts`: `IdSchema` (`z.uuid()`), `ScopeRefSchema` (a union of three
  strict objects, so two ids or none fail) and `ScopeRef`.
- `apps/server/src/http/http-error.ts` (`HttpError(status, code, message, extra?)`),
  `error-handler.ts` (`errorHandler`), `validate.ts` (`validate(schema, value)`).
- `apps/server/src/actor/middleware.ts` (`ActorResolver`, `actorMiddleware`, `actorOf`),
  `keys.ts` (`personOf`, `actorKey`, `auditActor`), `require-human.ts` (`requireHuman`).
- `apps/server/src/scope/resolve-scope.ts` (`resolveScope`, `ResolvedScope`) and
  `member-role.ts` (`memberRole`).
- `apps/server/src/config.ts`: `devActorHeaderEnabled(env)`.
- `apps/server/src/app.ts`: `createApp({ db, resolveActor?, devActorHeader?, now?, webDist? })`.
- `apps/server/src/server.ts`: passes `db` and `devActorHeader` to `createApp`; listens on
  127.0.0.1 when the dev header is on.
- `apps/server/src/testing/harness.ts`: `startTestServer`, `TestServer`, `TestClient`,
  `TestResponse`, `TestServerOptions`.
- Tests: `src/actor/actor.test.ts`, `src/scope/resolve-scope.test.ts`,
  `src/scope/validate.test.ts`, `src/http/error-handler.test.ts`,
  `src/testing/harness.test.ts`; `src/config.test.ts` and `src/app.test.ts` extended (app tests
  now open a test db and send an actor for the unknown-path 404, plus a no-actor 401 case).
- `docs/DECISIONS.md` D15; `docs/PLAN.md` section 9 gains the "Until then (D15)" line.

**Proof** (each run fresh after the last edit)
- `pnpm --filter @sky-brain/server exec vitest run src/actor src/scope src/config --reporter=verbose`:
  4 files, 34 tests passed, exit 0. All eight `prints` names appear: refuses a request with no
  actor; refuses the dev header when it is off; refuses a malformed dev header; accepts the dev
  header in development; checks the actor before the body; refuses an agent on a humans-only
  route; hides a workspace the caller is not a member of; refuses an id that is not a uuid.
  The same run covers malformed JSON → 400 `invalid_json`, 70 KB → 413 `too_large`, `/healthz`
  without an actor → 200, resolveScope at each level, a viewer's role, an agent for a member,
  missing ids → 404, `memberRole`, `actorKey`/`auditActor`, and `devActorHeaderEnabled` for
  `development`, `production`, `test`, unset, empty and near-misses.
- `node tools/dev-smoke.mjs`: printed `sky-brain listening on 127.0.0.1 port 46755 (dev actor
  header on)` then `healthz 200`, exit 0.
- `pnpm lint && pnpm typecheck && pnpm test`: exit 0. Prettier "All matched files use Prettier
  code style!"; shared 15/15 tests, server 11 files 68/68 tests.
- Extra manual check (scratch script calling `start`): `nodeEnv: "development"` bound
  `127.0.0.1` and a request with `X-Dev-Actor` got 404 `not_found` (passed the actor);
  `nodeEnv: "test"` bound `0.0.0.0` and the same request got 401 `dev_actor_disabled`.

**Decisions**
- The actor is attached through a `WeakMap<Request, Actor>` read with `actorOf(req)`, not by
  augmenting Express's `Request` type: typed, no global declaration, and a route that runs
  without the middleware throws instead of seeing `undefined`.
- `X-Dev-Actor` counts as present whenever the header is sent, even empty; empty is
  `invalid_dev_actor` when on, `dev_actor_disabled` when off.
- With no `resolveActor`, `createApp` resolves nobody, so production answers 401 to every
  `/api/v1` request until the auth feature supplies a resolver.
- The error middleware is the last middleware and is mounted on `/api`, so non-API paths (the
  web shell) keep Express's own error page instead of a JSON 500.
- `start` derives the flag from `Config.nodeEnv` (`devActorHeaderEnabled({ NODE_ENV:
  config.nodeEnv })`), so `Config` keeps its shape and `server.test.ts` (not in Touches) needs no
  change.
- `validate` reports the first zod issue's message and its path joined with `.` as `field`
  (omitted when the path is empty).
- `resolveScope` and `memberRole` take `DbOrTx` so routes can call them inside a transaction.
  `resolveScope` throws `HttpError(404, "not_found")`; `memberRole` returns `undefined` and the
  route answers.
- The harness reuses one random token per distinct actor and closes all connections on
  `close()` so keep-alive sockets from `fetch` do not hold the server open.

**Shortcuts taken**
- Body-parser errors other than parse failure and too-large (unsupported charset or encoding)
  become 500 `internal`, as the ticket says. Worth a 415 mapping if a client ever sends them.
- `now` is accepted by `createApp` but unused until routes arrive.

**For later tickets**
- Routes: `actorOf(req)` gives the actor; put `requireHuman` first on human-only routes; check
  path ids with `validate(IdSchema, req.params.id)` and bodies with `validate(schema, req.body)`;
  `resolveScope(db, actor, ref)` for a scope, `memberRole(db, workspaceId, actor)` from an entry.
  Throw `HttpError` for any refusal; Express 5 forwards async throws to `errorHandler`.
- Mount routers in `createApp` on `/api/v1` after the actor/json middleware and before the
  `/api` 404 handler.
- 05: `startTestServer` ignores `rateLimit` today (acceptance helpers already pass it); add it to
  `TestServerOptions` and forward it to `createApp`. Audit: `writeAudit(tx, { actor:
  auditActor(a).actor, details: { ...auditActor(a).details, ... } })`.

