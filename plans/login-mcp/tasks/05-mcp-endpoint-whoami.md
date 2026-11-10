# Serve /mcp behind the bearer check, as an agent acting for the person, with whoami

Type: task
Status: resolved
Blocked by: 02, 03, 04
Test first: yes
Level: 3
Touches: apps/server/src/mcp/, apps/server/src/app.ts, docs/PLAN.md

LOGIN-MCP-PLAN step 5, and the bar's end-to-end test. Blocked by 04 because the end-to-end test
drives the consent step that ticket adds, and by 03 because only its sign-in hook gives each
person the own workspace and accepted invites that `whoami` lists. People sign in through the
harness's fake Perminister (`setPerministerAccount`, `approve`; spec.md Interfaces).

**Route** (`mcp/route.ts`, new): `mountMcp(app, { auth, db, publicUrl })` mounts
`app.all("/mcp", toNodeHandler(requireMcpAuth(auth, handler, { resource: publicUrl + "/mcp",
issuer: publicUrl + "/api/auth" })))` (`toNodeHandler` from `better-auth/node` takes a bare
`(Request) => Promise<Response>`). `requireMcpAuth` checks the signature against our JWKS, the
issuer, the audience and expiry (not `azp`: `actorFromMcpClaims` below does that; map.md), reads
the token only from the `Authorization` header, and answers anything else with 401 and
`WWW-Authenticate: Bearer resource_metadata="<publicUrl>/.well-known/oauth-protected-resource/mcp"`.
`handler` turns the verified claims into an actor (below; none → the same 401) and calls
`createMcpHandler(factory)` (default `legacy: "stateless"`, spec.md Decisions) with
`fetch(request, { authInfo: { token: "", clientId: azp, scopes, extra: { actor } } })`; never put the
raw token in `authInfo`. `createApp` calls `mountMcp(app, { auth: options.auth.instance, db: options.db, publicUrl:
options.auth.publicUrl })` when `auth` is given (ticket 02 put both in `AppOptions.auth`, so
`server.ts` and the harness do not change), next to `mountAuth` and
before the `/api` 404 and the web catch-all. No scope is required on `/mcp` yet (spec.md Decisions).

**Actor** (`mcp/actor.ts`, new): `actorFromMcpClaims(claims)` returns
`{ kind: "agent", agent_id: "mcp/" + <lower-cased hostname of azp>, on_behalf_of: <sub> }` parsed with
`ActorSchema`; a missing `sub`, an `azp` that is not an HTTPS URL, or anything that fails the schema
gives undefined. It is an agent so `requireHuman` refuses MCP callers (CLAUDE.md hard rule 3,
spec.md Decisions). It is the bearer-JWT `ActorResolver` the brief names, for `/mcp` only.

**Tools** (`mcp/server.ts`, `mcp/whoami.ts`, new): the factory builds a `McpServer` (name
`sky-brain`) and registers `whoami` (no input schema fields; arguments are ignored). It reads the
actor from `ctx.authInfo.extra.actor`, takes `personOf(actor)`, loads that user's email from the
Better Auth `user` table and their memberships joined to `workspaces` (filtered by that user id
only), and returns spec.md Interfaces → `whoami`: every workspace the person belongs to (their own
and any they were invited to), never one they are not in. The token is not tied to one workspace
(spec.md Decisions: membership is checked on every call, as `resolveScope` already does). Later tickets add the six Layer 1 tools to the
same factory; describe `whoami` so an agent knows it is the connection check.

**Docs.** `docs/PLAN.md` sections 8 and 9 say in one line each: MCP callers are agents
`mcp/<client host>` acting for the token's subject, across all of that person's workspaces;
`legacy: "stateless"`; scopes advertised but not required until write tools land. No decision
here: these go into the "T0 result" decision (ticket 07).

Tests (`mcp/mcp.test.ts` and `mcp/claude-flow.test.ts`, new, through `startAuthTestServer`; tokens
for refusal cases from `signJwt`, real ones from the flow):
- "mcp: no token answers 401 with the resource_metadata challenge" — exact header value.
- "mcp: a token for another audience is refused" — `signJwt` with `aud` `<url>/api/auth`, and the
  session JWT from `GET /api/auth/token`.
- "mcp: an expired token is refused", "mcp: a token from another issuer is refused",
  "mcp: a tampered token is refused" — each 401 with the challenge.
- "mcp: a token in the query string is refused" — `?access_token=<good token>` → 401.
- "mcp: whoami ignores arguments that name someone else" — `arguments: { email: "x@evil.test" }`
  still returns the token's person.
- "mcp: whoami lists every workspace of the caller and no other" — three Perminister accounts
  with `sky-brain` access (an owner, a second person invited as `editor` to the owner's workspace,
  and a third person); each signs in through the flow. The second person's `whoami` lists two workspaces (their own as
  `owner`, the owner's as `editor`); the owner's and the third person's list only their own
  (hard rule 4).
- "mcp: an MCP caller is an agent and requireHuman refuses it" — `actorFromMcpClaims` gives an
  agent "mcp/claude.ai" acting for `sub`; on a small Express app with `actorMiddleware` and
  `requireHuman`, that actor gets 403 `humans_only` and a human actor passes (allowed and refused).
- "claude.ai flow: CIMD client signs in with Perminister and whoami returns the email" — one test that
  walks spec.md Happy path 1 to 8 like claude.ai: the 401 challenge, both discovery documents
  (resource, issuer, `S256`, `none`, CIMD flag), authorize → sign-in → consent → token with PKCE
  to `https://claude.ai/api/mcp/auth_callback` (the sign-in step going through
  `/auth/perminister/callback`), then `initialize` and `whoami` returning the signed-in
  Perminister account's email.
- "claude.ai flow: a Claude Code client on any loopback port gets whoami" — the same with
  `http://localhost:53682/callback`.

## Not in this ticket

- The six Layer 1 tools (`context`, `search`, `get`, `post`, `supersede`, `ask`): later rounds,
  once brain-core's routes exist.
- Scope enforcement for write tools: with those tools.
- Bearer tokens on `/api/v1`: T7.

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/mcp --reporter=verbose` passes and its
  output contains the `prints` lines below.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/mcp --reporter=verbose
prints mcp: no token answers 401 with the resource_metadata challenge
prints mcp: a token for another audience is refused
prints mcp: an expired token is refused
prints mcp: a token from another issuer is refused
prints mcp: a tampered token is refused
prints mcp: a token in the query string is refused
prints mcp: whoami ignores arguments that name someone else
prints mcp: whoami lists every workspace of the caller and no other
prints mcp: an MCP caller is an agent and requireHuman refuses it
prints claude.ai flow: CIMD client signs in with Perminister and whoami returns the email
prints claude.ai flow: a Claude Code client on any loopback port gets whoami
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Interfaces (`whoami`, How a test reaches the server), § Decisions, § Edge cases.
- map.md (the spike's `/mcp` lines: SSE body, `ctx.authInfo`, claims shape).
- `apps/server/src/actor/keys.ts` (`personOf`), `apps/server/src/actor/require-human.ts`,
  `packages/shared/src/actor.ts` (`AgentIdSchema` allows the agent id "mcp/claude.ai").

## Answer

Work started at `192ebae3a05893808eed80da515c61362e8a09de`; the failing tests were committed alone
first (`7316321 test(login-mcp): 05 failing test`). At that commit `mcp.test.ts` failed with
`Cannot find module './actor.ts'` and both `claude-flow.test.ts` tests failed with `expected 404
to be 401` (no `/mcp` route; the SPA catch-all answered).

- **Built**:
  - `apps/server/src/mcp/route.ts` (new): `mountMcp(app, { auth, db, publicUrl })`,
    `app.all("/mcp", toNodeHandler(requireMcpAuth(auth, handler, { resource: <publicUrl>/mcp,
    issuer: <publicUrl>/api/auth })))`; the handler turns the claims into an actor (none → 401
    with the same `resource_metadata` challenge) and calls `createMcpHandler(factory).fetch` with
    `authInfo { token: "", clientId: azp, scopes, extra: { actor } }`.
  - `apps/server/src/mcp/actor.ts` (new): `actorFromMcpClaims(claims)`.
  - `apps/server/src/mcp/server.ts` (new): `mcpServerFactory(db)`, `McpServer` named `sky-brain`;
    re-parses `ctx.authInfo.extra.actor` with `ActorSchema` before registering tools.
  - `apps/server/src/mcp/whoami.ts` (new): `whoami(db, actor)` and `registerWhoami`.
  - `apps/server/src/mcp/mcp.test.ts`, `claude-flow.test.ts` (new tests), `test-flow.ts` (new
    shared test helper: the authorize → sign-in → consent → token flow, MCP POSTs, SSE parsing).
  - `apps/server/src/app.ts`: `mountMcp` right after `mountAuth` when `auth` is given.
  - `docs/PLAN.md`: section 8 (one paragraph: `/mcp`, `legacy: "stateless"`, `whoami`, MCP
    callers are agents `mcp/<client host>` for the token's subject across their workspaces) and
    section 9 (one sentence: `brain:*` scopes advertised, not required until write tools land).
- **Proof** (all run after the last edit):
  - `pnpm --filter @sky-brain/server exec vitest run src/mcp --reporter=verbose`: exit 0,
    2 files, 11 tests passed; every one of the 11 `prints` lines appears as a `✓` line.
  - `pnpm lint && pnpm typecheck && pnpm test`: exit 0; eslint and prettier clean, tsc clean in
    all three packages, server 23 files / 299 tests passed, shared 2 files / 15 tests passed.
- **Decisions**:
  - The actor is read in the factory (`McpRequestContext.authInfo`) and closed over by the tool,
    rather than from the tool's `ctx.http.authInfo`; it is parsed again with `ActorSchema` there
    so a factory reached without a verified actor throws instead of serving anyone.
  - `whoami` throws (MCP tool error) when the token's subject has no `user` row, instead of
    answering an empty email.
  - The no-actor 401 from `route.ts` is built by hand with the exact header `requireMcpAuth`
    sends, so a token whose claims give no actor looks like any other refused token. Tested
    (`sub` missing, `azp` over HTTP) inside "mcp: an MCP caller is an agent ...".
  - Refusal tests carry a control: the same `signJwt` claims with the right `aud`/`iss`/`exp`
    pass (`initialize` 200), so each refusal is caused by the one field changed.
  - `test-flow.ts` is typed without `any` because the lint relaxation covers only `*.test.ts`
    and `src/testing/**`, and `src/testing/` is outside Touches.
- **Shortcuts taken**:
  - `requireMcpAuth` fetches the JWKS from `<publicUrl>/api/auth/jwks` over HTTP (its default),
    so on Vercel the function calls its own public URL to verify a token. It works wherever the
    function can reach its own origin; if that latency or self-call becomes a problem, pass a
    local `remoteVerify`/JWKS via `createMcpProtectedRequestHandler` instead.
  - `whoami` orders workspaces by `created_at`; nothing depends on the order.
- **For later tickets**:
  - Later tools go in `mcp/server.ts`'s factory; the actor is the `actor` argument there. Write
    tools must call `requireHuman`-style checks themselves (the actor is an agent) and require
    `brain:write` (spec.md Decisions → Scopes), e.g. with `requireMcpAuth`'s `requiredScopes` or
    a per-tool `scopeChallenge`.
  - 07: `pnpm --filter @sky-brain/server exec vitest run src/mcp/claude-flow.test.ts
    --reporter=verbose` prints the bar's line. `test-flow.ts` holds the reusable flow helpers.
