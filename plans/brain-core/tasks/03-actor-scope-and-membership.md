# Resolve the actor, the scope and membership for every /api/v1 request

Type: task
Status: open
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
