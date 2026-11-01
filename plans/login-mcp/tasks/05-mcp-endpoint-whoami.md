# Serve /mcp behind the bearer check, as an agent acting for the person, with whoami

Type: task
Status: open
Blocked by: 02, 03, 04
Test first: yes
Level: 3
Touches: apps/server/src/mcp/, apps/server/src/app.ts, docs/PLAN.md

LOGIN-MCP-PLAN step 5, and the bar's end-to-end test. Blocked by 04 because the end-to-end test
drives the consent step that ticket adds, and by 03 because only its access rules let a second
person in and only its sign-in hook gives each person the own workspace and accepted invites that
`whoami` lists.

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
here: these go into D18 (ticket 07), since login-mcp owns only D16 to D18.

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
- "mcp: whoami lists every workspace of the caller and no other" — the harness's bootstrap owner,
  a second allowed person invited as `editor` to the owner's workspace, and a third allowed person;
  each signs in through the flow. The second person's `whoami` lists two workspaces (their own as
  `owner`, the owner's as `editor`); the owner's and the third person's list only their own
  (hard rule 4).
- "mcp: an MCP caller is an agent and requireHuman refuses it" — `actorFromMcpClaims` gives an
  agent "mcp/claude.ai" acting for `sub`; on a small Express app with `actorMiddleware` and
  `requireHuman`, that actor gets 403 `humans_only` and a human actor passes (allowed and refused).
- "claude.ai flow: CIMD client signs in with Google and whoami returns the email" — one test that
  walks spec.md Happy path 1 to 8 like claude.ai: the 401 challenge, both discovery documents
  (resource, issuer, `S256`, `none`, CIMD flag), authorize → sign-in → consent → token with PKCE
  to `https://claude.ai/api/mcp/auth_callback`, then `initialize` and `whoami` returning the
  bootstrap owner's email.
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
prints claude.ai flow: CIMD client signs in with Google and whoami returns the email
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
