# login-mcp — Spec

## Problem

brain-core (tickets 01 to 04 on `claude/brain-core`) knows only one caller: the dev-only
`X-Dev-Actor` header, honoured when `NODE_ENV=development` and on 127.0.0.1 (D15). `createApp`
gets `resolveActor` defaulting to `() => undefined`, so outside the developer's own machine every
`/api/v1` request is 401 and there is no `/mcp` at all. Nobody can sign in, and claude.ai, the
Claude phone app and Claude Code cannot add sky-brain as a connector.

This feature is steps 3 to 8 of `docs/layer-1/LOGIN-MCP-PLAN.md` (Layer 1 tickets T0, the core of
T3 and the first cut of T6): people sign in with Perminister (Zakai Hamilton's hosted identity
service; shammai replaced Google with it on 2026-11-09), sky-brain becomes its own OAuth 2.1
authorization server (Perminister is only the sign-in page behind it), and `/mcp` serves MCP over
streamable HTTP to clients that hold one of its access tokens, acting as the signed-in person.
It runs on Vercel with Postgres on Nanogres (D16, already on the base branch).

## Goal and the bar

Done means a person Perminister signs in for the `sky-brain` product can sign in with
Perminister and gets their own workspace, and an MCP client that registers with a Client ID Metadata Document (CIMD) can run the whole OAuth 2.1 +
PKCE flow and call `whoami` on `/mcp`, getting back the signed-in person's email and every workspace they belong to.

Brief decisions this spec carries (Decided lines): each person who signs in gets their own board,
a personal workspace with them as owner, created at first sign-in, with the workspace (global)
scope on top and projects and features under it; workspaces stay walled off (hard rule 4); an
invite adds a person to another owner's workspace and also works for someone who already has an
account; `whoami` lists every workspace the caller belongs to; who may sign in at all is decided
by Perminister, which is invite-only for this product: anyone it signs in with access to the
`sky-brain` product may enter (shammai, 2026-11-09; this replaces the earlier `ALLOWED_EMAILS`
allowlist and `BOOTSTRAP_OWNER_EMAIL`), checked in one function so a gate can be added later. sky-brain is Pathly's knowledge
board in the cloud without CLI spawning (D1); tasks, claims and their state machine stay in Pathly
(D3), and a cloud task board is a separate later feature.

**The bar.**

1. `pnpm test` exits 0 and includes tests that drive the whole claude.ai flow against the app
   with Perminister faked: `/mcp` without a token answers 401 with a `resource_metadata` challenge;
   the discovery documents carry the exact `resource`, issuer, `S256`, `none` and
   `client_id_metadata_document_supported: true`; a CIMD client completes authorize → token
   with PKCE to `https://claude.ai/api/mcp/auth_callback`; a loopback redirect on any port is
   accepted; and `whoami` returns the email of the person the token was issued to.
2. After deploy to `https://sky-brain.vercel.app` with shammai's Perminister app client,
   claude.ai's `whoami` returns shammai's email (a manual check, recorded in `docs/CONNECT.md`).

## Stories

### A person signs in with Perminister

**As** a person Perminister has given access to sky-brain, **I want** to sign in with my
Perminister account, **so that** sky-brain knows who I am, gives me my own board, and lets me into
the workspaces I was invited to.

- [ ] `GET /sign-in` answers 200 `text/html` with a "Sign in with Perminister" button.
- [ ] Signing in with a Perminister account whose token exchange lists an organization for product
      `sky-brain` creates that person (a `user` row, and an `account` row with `provider_id`
      `perminister` and `account_id` equal to the Perminister `subjectId`; the Drizzle tables
      `user` and `account`, fields `providerId` and `accountId`, are exported from
      `apps/server/src/db/schema.ts`), one workspace of their
      own and an `owner` membership in it. Signing in again creates no second user, workspace or
      membership.
- [ ] Two such people who sign in get two workspaces, and neither can see the other's:
      each one's `whoami` (Interfaces → `whoami`, reached through `startAuthTestServer` and the
      flow in Interfaces) lists exactly one workspace, their own as `owner`, and the two `id`s
      differ (hard rule 4).
- [ ] A person with a pending row in `invites` (matched on their Perminister email, any case) gets,
      at sign-in, a `members` row with the invite's role in that workspace, and the invite's
      `accepted_at` is set. This holds for a first sign-in and for a person who already had an
      account when the invite was made.
- [ ] A Perminister account with no organization for product `sky-brain` creates no user and no
      session: the browser lands on `/sign-in?error=no_access` and the page says "No access". A
      pending invite for its email stays pending.
- [ ] A Perminister account with no email creates no user and no session: the browser lands on
      `/sign-in?error=email_not_found` and the page says "No access".
- [ ] A person whose `sky-brain` access was taken away in Perminister gets "No access" at their
      next sign-in.
- [ ] A Perminister callback with a forged `state`, or with a code Perminister refuses (reused,
      expired, wrong PKCE verifier), creates no session.
- [ ] The Perminister client secret never reaches the browser: the authorize URL the browser is
      sent to carries `client_id` and never the secret.
- [ ] With the session cookie the sign-in set, a request to `/api/v1/<unknown path>` answers
      404 (the caller is known); without it, 401 `unauthenticated`.

### claude.ai adds sky-brain as a connector

**As** shammai using claude.ai, **I want** to add `https://<host>/mcp` as a custom connector with
no client id or secret, **so that** Claude can read my brain as me.

- [ ] `POST /mcp` with no token answers 401 with
      `WWW-Authenticate: Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource/mcp"`.
- [ ] `GET /.well-known/oauth-protected-resource/mcp` (and the same path without `/mcp`) answers
      200 JSON with `resource` exactly `<PUBLIC_URL>/mcp` and `authorization_servers[0]` exactly
      `<PUBLIC_URL>/api/auth`.
- [ ] `GET /.well-known/oauth-authorization-server/api/auth` answers 200 JSON with `issuer`
      `<PUBLIC_URL>/api/auth`, `code_challenge_methods_supported` `["S256"]`,
      `token_endpoint_auth_methods_supported` containing `"none"`,
      `client_id_metadata_document_supported: true`, and no `registration_endpoint`.
- [ ] A client whose `client_id` is an HTTPS CIMD URL listing
      `https://claude.ai/api/mcp/auth_callback` completes authorize → Perminister sign-in → consent →
      token with PKCE S256, and gets a JWT `access_token` plus a `refresh_token`.
- [ ] A Claude Code-style CIMD client listing `http://localhost/callback` and
      `http://127.0.0.1/callback` is accepted with a redirect on any port
      (`http://localhost:53682/callback`, `http://127.0.0.1:3118/callback`).
- [ ] `whoami` over `/mcp` with that token returns the signed-in person's email and every
      workspace they are a member of (their own and those they were invited to) and no other,
      whatever the tool arguments say.

### Hostile callers get nothing

**As** the owner, **I want** forged, misdirected and stolen-looking requests refused, **so that**
nobody acts as someone else.

- [ ] A redirect URI not in the client's metadata document is refused (no code is issued).
- [ ] A token request without the PKCE verifier, or with a wrong one, is refused; a reused code
      answers `invalid_grant`; a dead refresh token answers `invalid_grant`.
- [ ] `/mcp` refuses with 401 a token with the wrong audience, the wrong issuer, an expired
      token, a bad signature, and the session JWT from `GET /api/auth/token`.
- [ ] A token sent as `?access_token=` in the URL is refused with 401 (CLAUDE.md hard rule 5).
- [ ] `POST /api/auth/oauth2/register` does not exist (DCR stays off).
- [ ] The `/consent` page cannot be framed (`frame-ancestors 'none'`) and shows the redirect host.

## Scope

In:
- Better Auth 1.7.15 with "Sign in with Perminister" (its `genericOAuth()` plugin with our own
  token exchange; no Google), `jwt()`, `mcp()` (`@better-auth/mcp` 1.7.15) and `cimd()`
  (`@better-auth/cimd` 1.7.15), on the existing Drizzle database (PGlite in tests and dev,
  Nanogres Postgres on Vercel), with its tables in a new migration.
- Perminister decides who may sign in (access to the `sky-brain` product, checked in one
  function); a personal workspace per person at first sign-in; invite acceptance on every
  sign-in; "No access" for everyone else.
- A session-cookie `ActorResolver` for `/api/v1`, and a bearer-JWT resolver for `/mcp`
  (audience `<PUBLIC_URL>/mcp`).
- `/sign-in` and `/consent` pages.
- `/mcp` over streamable HTTP (`@modelcontextprotocol/server` 2.4.0) with `whoami`. The six Layer
  1 tools come as brain-core's routes land (see Not in scope).
- The auth instance wired into the Vercel function (`apps/server/src/vercel.ts`), the list of
  environment variables shammai sets in Vercel's dashboard, and `docs/CONNECT.md`. Hosting itself
  is settled (D16; ticket 01 records the answer).

Not in scope:
- The scaffold and PGlite harness: brain-core 01 and 02 built them.
- The six Layer 1 MCP tools (`context`, `search`, `get`, `post`, `supersede`, `ask`): brain-core
  05 to 10 have not built their routes yet; each tool is added in a later round on top of the
  service layer those tickets build (T6 proper).
- An owner-facing invite route: T3's invite UI and route belong with T8 (web page) and T4's
  human-only routes; tests seed `invites` rows directly.
- Device login and run tokens: T7. The web page: T8. The Pathly client: T10.
- Dynamic client registration: off, as the brief says.
- `render.yaml` and any Render setup: removed by D16.
- Perminister's own authorization (`POST /api/authorize`), member management and workspace
  grants: sky-brain keeps its own `members` and `invites`; Perminister only signs people in.
- Keeping the Perminister session alive or revoking it at sign-out: sky-brain uses only the
  exchange's identity, then its own Better Auth session.
- The cloud task board, and tasks, claims and their state machine: they stay in Pathly (D3); a
  cloud task board is a separate later feature.

## Happy path

1. claude.ai `POST /mcp` with no token → 401 with the `resource_metadata` challenge.
2. claude.ai reads `/.well-known/oauth-protected-resource/mcp` → learns resource
   `<PUBLIC_URL>/mcp` and issuer `<PUBLIC_URL>/api/auth`.
3. claude.ai reads `/.well-known/oauth-authorization-server/api/auth` → sees CIMD, `none` and
   `S256`.
4. claude.ai sends the person to `/api/auth/oauth2/authorize?client_id=<CIMD URL>&...` → Better
   Auth fetches and validates the metadata document, checks the redirect URI, and sends the
   person to `/sign-in?<signed query>`.
5. The person presses "Sign in with Perminister" → the page posts the signed query to
   `/api/auth/sign-in/social` (provider `perminister`) → Better Auth stores the state and PKCE
   verifier in its `verification` table and sends the person to
   `<PERMINISTER_BASE_URL>/oauth/authorize` → Perminister → `/auth/perminister/callback` → 302 to
   `/api/auth/callback/perminister` → Better Auth checks the state and our `getToken` exchanges the
   code at `<PERMINISTER_BASE_URL>/api/auth/consumer/token` → `mayEnter` lets an account with
   `sky-brain` access in → Better Auth finds or creates the user by Perminister `subjectId` and
   starts its session → the sign-in hook gives a first-time person their own workspace and accepts
   pending invites → Better Auth resumes the authorization and sends the person to
   `/consent?<signed query>`.
6. The consent page shows the client name and the redirect host → the person presses Allow →
   `/api/auth/oauth2/consent` → redirect to `https://claude.ai/api/mcp/auth_callback?code=...`.
7. claude.ai swaps the code at `/api/auth/oauth2/token` (form-urlencoded, PKCE verifier) → JWT
   access token (audience `<PUBLIC_URL>/mcp`) and refresh token.
8. claude.ai calls `whoami` on `/mcp` with `Authorization: Bearer <jwt>` → the email and
   every workspace of the person the token's `sub` names.

## Edge cases

| Trigger | Expected behaviour | Handled in ticket |
|---|---|---|
| Perminister account with no organization for product `sky-brain` | No user, no session; `/sign-in?error=no_access` shows "No access" | 03 |
| Such an account with a pending invite | Same as above; the invite stays pending | 03 |
| `sky-brain` access taken away in Perminister later | "No access" at the next sign-in (existing sessions and tokens run out on their own expiry) | 03 |
| Perminister account with no email | No user, no session; `/sign-in?error=email_not_found` shows "No access" | 03 |
| Callback with a forged or missing `state` | Better Auth's error page (`error=state_mismatch`); no session | 03 |
| Perminister refuses the code (reused, older than 5 minutes, wrong verifier) or does not answer within 10 s | `/sign-in?error=invalid_code`; no session | 03 |
| Same Perminister `subjectId` signs in again | Same user (the `account` row is keyed by `subjectId`), no new workspace | 03 |
| A person signs in a second time | No new workspace, no new membership | 03 |
| Invite made after the person already has an account | Accepted at their next sign-in | 03 |
| Email in another case (`Ann@X.com` vs `ann@x.com`) in Perminister or an invite | Matches | 03 |
| A person later removed from every workspace, their own included | Next sign-in gives them a new own workspace (no `members` row means first-board rules) | 03 |
| A person in several workspaces | `whoami` lists all of them; each call is checked against the scope it names | 05 |
| Redirect URI not in the CIMD document | Authorize ends at Better Auth's error page; no code | 04 |
| Loopback redirect with a port | Accepted for `localhost` and `127.0.0.1` registered without a port | 04 |
| Missing or wrong PKCE verifier | Token endpoint refuses | 04 |
| Reused authorization code | `invalid_grant` | 04 |
| Dead refresh token | `invalid_grant` | 04 |
| Person presses Deny on consent | Redirect to the client with `error=access_denied` | 04 |
| Token for another audience (session JWT from `/api/auth/token`) | 401 on `/mcp` | 05 |
| Expired, wrong-issuer or tampered token | 401 with the challenge | 05 |
| Token in the query string | 401 | 05 |
| `whoami` arguments name another email | Ignored; identity only from the token | 05 |
| `NODE_ENV=production` without `PUBLIC_URL`, `BETTER_AUTH_SECRET`, `PERMINISTER_BASE_URL`, `PERMINISTER_CLIENT_ID` or `PERMINISTER_CLIENT_SECRET`, or `PUBLIC_URL` or `PERMINISTER_BASE_URL` not HTTPS | `readConfig` throws naming the setting, so neither `start` nor the Vercel function comes up (Interfaces → Settings) | 02 |
| A second Vercel instance serves the callback, consent or token request | Works: state, verifier, sessions, codes and JWKS live in Postgres (Decisions → Serverless) | 02 |
| `X-Dev-Actor` with the dev header off | Still 401 `dev_actor_disabled` (D15), even with a valid session | 03 |

## Design

```
 browser ──cookie──► /sign-in, /consent (pages from TS modules, CSP)
    │                       │ fetch
    ▼                       ▼
 /auth/perminister/callback ─302─► /api/auth/callback/perminister
 /api/auth/* ──────► Better Auth (genericOAuth "perminister", jwt, mcp, cimd)
 /.well-known/* ───►   │  getToken ──HTTPS──► Perminister /api/auth/consumer/token
                       │  mayEnter (sky-brain access), onSignIn (own workspace, invites)
                       │  CIMD fetch (resolve-once, public IPs)
                       ▼
                 Drizzle db: user, session, ..., oauth_* + members
                       ▲
 /api/v1 ──► actorMiddleware(resolveActor = session cookie → human)
 /mcp ─────► requireMcpAuth(JWT: sig, iss, aud, exp) ──► actorFromMcpClaims(sub, azp) ──► agent actor
                 └► createMcpHandler(factory) ──► whoami
 failure: no/bad token ──► 401 + WWW-Authenticate resource_metadata
```

All of it is mounted in `createApp` before the `/api` 404 handler, `express.static` and the
`/{*splat}` catch-all, which would otherwise shadow it. The same `createApp` runs under
`start` (dev, tests) and as the one Vercel function (`apps/server/src/vercel.ts`, D16); both build
the auth instance through one function, `authFromConfig`.

### Decisions

- **Who may sign in** (shammai, 2026-11-09, replacing the brief's `ALLOWED_EMAILS` allowlist and
  `BOOTSTRAP_OWNER_EMAIL`) — Perminister is invite-only for this product (self sign-up off on the
  client), so its invitations are the gate. Options: A, enter when Perminister signs the person in
  **and** the token exchange's `organizations[]` lists one with `productId` `sky-brain`; B, enter
  whenever the exchange succeeds. Chosen: A. Why: it is what "signed in for the `sky-brain`
  product" means in Perminister's own data (the exchange returns "the organization contexts
  associated with the account for this product"), it costs one check, and it gives a refused case
  a test can drive. The whole rule is one function, `mayEnter` (`auth/access.ts`), so a later gate
  (an allowlist, a Perminister role) changes that function only. Rejected: B; keeping
  `ALLOWED_EMAILS` (shammai dropped it).
- **A Perminister account with no email** (shammai left it to the plan; "refuse" is the safe
  default he named) — options: A, refuse; B, create the user with a placeholder email. Chosen: A.
  Why: `whoami`, invites and the own workspace's name all use the email. Better Auth already
  refuses before the user is created (`/sign-in?error=email_not_found`, map.md repair spike), and
  `mayEnter` refuses it too, so the rule holds even if that changes.
- **How Perminister plugs into Better Auth** — options: A, Better Auth's own `genericOAuth()`
  plugin (in `better-auth/plugins`) with provider id `perminister`, `authorizationUrl`
  `<PERMINISTER_BASE_URL>/oauth/authorize`, `redirectURI` `<PUBLIC_URL>/auth/perminister/callback`,
  PKCE on, and our own `getToken` (the exchange, which is not a standard token endpoint) and
  `getUserInfo` (reads the exchange's `account` and `organizations`); B, our own start and callback
  routes that keep the state and verifier in a signed cookie, exchange the code, then create the
  Better Auth user, account and session by hand through `auth.$context.internalAdapter`. Chosen: A.
  Why: the repair spike ran it on 1.7.15 with `mcp()` and `cimd()`: the state and verifier live in
  Better Auth's `verification` table (serverless-safe), the user is keyed by `subjectId` in
  `account`, `user.validateUserInfo` and `databaseHooks.session.create.after` run as with Google,
  and the pending OAuth authorization resumes to `/consent` unchanged; B re-implements all of it,
  including the session cookie that the `mcp()` resume hook watches for. Generic providers join
  Better Auth's social providers, so sign-in is `POST /api/auth/sign-in/social` with
  `provider: "perminister"`, and the callback is `/api/auth/callback/perminister`; Perminister's
  fixed path `/auth/perminister/callback` answers 302 to it with the same query. We write our own
  client code; the reference client in `zakaihamilton/visitoring` has no licence and is not copied.
- **Where sign-in refuses** — options: A, Better Auth's `user.validateUserInfo`, which runs before
  the user is created and on every later sign-in with the fresh profile (here, the exchange's
  `organizations`, as `source.oauth.profile`); B, `databaseHooks.user.create.before`, which runs
  once. Chosen: A. Why: least privilege (a refused person gets no user row, session or token for
  `/mcp`), and access taken away in Perminister takes effect at the next sign-in. The repair spike
  showed A redirects to `/sign-in?error=no_access` with no user row for a generic provider too.
- **The Perminister session token** — the exchange returns a `sessionToken`; sky-brain needs only
  the identity, then runs its own Better Auth session. Better Auth stores provider tokens in
  `account.access_token`; set `account.encryptOAuthTokens: true` so it is encrypted at rest, and
  never log it, the client secret or the exchange body.
- **Serverless** (shammai, item 9) — no state in process memory may be relied on across requests:
  Better Auth keeps OAuth state and PKCE verifiers (`verification`), sessions, authorization codes,
  refresh tokens and JWKS in Postgres, and its rate limiter is set to `storage: "database"` (its
  table comes from the CLI with the others). The CIMD fetch has no cache we rely on. Nothing uses
  session-level Postgres features (Risks → PgBouncer).
- **Pages ship inside the bundle** — options: A, each page is a TypeScript module exporting its
  HTML and its script as strings (`auth/pages/sign-in.ts`, `consent.ts`), served from memory; B,
  `.html` and `.js` files read from disk next to the source. Chosen: A. Why: the Vercel function is
  one esbuild bundle (`dist/vercel.mjs`), where `import.meta.url` points at `dist/` and loose files
  are not traced, so B needs a copy step plus `includeFiles` in `vercel.json`; A needs neither and
  is the same under `pnpm dev`. The cost: the browser scripts are strings, so ESLint does not lint
  them; the page tests pin what matters (`textContent`, no `innerHTML`).
- **What actor an MCP token yields** — options: A, `{kind: "agent", agent_id: "mcp/<client
  host>", on_behalf_of: <sub>}`; B, `{kind: "human", user_id: <sub>}`. Chosen: A. Why: CLAUDE.md
  hard rule 3 and PLAN section 8 keep rules, approve, reject, release and delete away from MCP
  callers; with B, `requireHuman` would let an MCP caller through and the rule would rest on
  route wiring alone. `personOf(actor)` still gives the person for membership.
- **When the own workspace and invites are applied** (fixes review finding 6) — options: A,
  `databaseHooks.session.create.after`, which runs on every sign-in, doing "own workspace if the
  person has no `members` row, then accept pending invites" in one transaction; B,
  `databaseHooks.user.create.after`, which runs once, so an invite sent to someone who already has
  an account would never be accepted. Chosen: A. Why: the brief requires invites to work for
  existing accounts, and A also repairs a first sign-in whose hook failed. The cost is one
  membership query per sign-in.
- **What the own workspace is** — a `workspaces` row named after the person's email, with an
  `owner` membership; no schema change, since brain-core's tables already allow many workspaces
  and every query goes through `resolveScope` or `memberRole`. Rejected: a `personal_owner_id`
  column to mark it, which nothing needs yet.
- **Is an MCP token tied to one workspace?** — options: A, no: the token acts for the person, and
  every call names a scope that `resolveScope` checks against that person's memberships, as
  `/api/v1` already does; B, yes: the consent page picks one workspace and the token carries it
  as a claim. Chosen: A. Why: the brief says `whoami` lists every workspace the caller belongs to,
  a person in several boards wants one connector for all of them, isolation already comes from the
  per-call membership check (hard rule 4), and B needs a workspace picker on consent and a custom
  claim. Headless run tokens (T7) stay bound to one workspace, project and role, as PLAN section 9
  says.
- **Sign-in and consent pages** — options: A, two small static HTML pages plus one script served
  by the server; B, routes in the React app (`apps/web`). Chosen: A. Why: T8 has not built the web
  app, the OAuth surface stays tiny, and a static page with a strict CSP renders untrusted CIMD
  text (`client_name`) only through `textContent`.
- **Legacy MCP traffic** — options: A, `createMcpHandler`'s default `legacy: "stateless"`, which
  serves both the 2026-07-28 protocol and 2025-era clients; B, `legacy: "reject"`. Chosen: A.
  Why: we cannot verify that claude.ai, the phone app and every Claude Code version already speak
  2026-07-28; the spike's whoami call was a 2025-06-18 `initialize`.
- **Scopes** — advertise `brain:read`, `brain:write` and `offline_access` (plus Better Auth's
  `openid`, `profile`, `email`); `/mcp` itself requires no scope, so a client that asks for none
  still gets `whoami`. Write tools will require `brain:write` when they land. Rejected: requiring
  `brain:read` on `/mcp` now, which would break a client that requests no scope.
- **Faking Perminister** — options: A, the harness gives `createAuth` a `fetch` for the Perminister
  calls that answers `<perministerUrl>/api/auth/consumer/token` like Perminister does (client
  headers, single-use codes bound to the PKCE challenge, the documented response shape), and
  `approve(authorizeUrl)` plays Perminister's `/oauth/authorize`; B, Better Auth's `testUtils`
  plugin to create sessions directly. Chosen: A. Why: it runs the real
  `/auth/perminister/callback`, `/api/auth/callback/perminister`, our `getToken` and `mayEnter`; B
  skips all of them. Injecting `fetch` (not wrapping `globalThis.fetch`) keeps tests in one file
  from leaking into another.
- **CIMD transport** — production uses `fetchClientMetadataResource` from `@better-auth/cimd/node`
  (resolves once, refuses non-public addresses and redirects); tests inject a fake that serves
  fixture documents. The fake is reachable only through the test harness's `createApp` options.
- **Default `PUBLIC_URL` outside production** — options: A, `http://localhost:<PORT>` from the
  config, so the auth instance and `createApp` are built before `listen` as today; B, listen
  first and build them from the bound port. Chosen: A. Why: `start` keeps its shape; port 0 is
  only used by tests, and the test harness sets its own URL. `localhost`, not `127.0.0.1`: the
  local-dev Perminister client's origin is the portless `http://localhost`, which accepts a
  callback on any localhost port and nothing else; `mcp()` accepts an HTTP `resource` on
  `localhost` (map.md).
- **One way to build the auth instance** — `authFromConfig(config, db)` (`auth/from-config.ts`)
  returns `{ instance, publicUrl }` for `createApp`'s `auth` option; `start` and the Vercel
  function both call it, so dev, tests and production cannot drift. Rejected: building it twice.
- **How `createApp` learns the public URL** — `AppOptions.auth` is `{ instance: Auth; publicUrl:
  string }`, so the two always arrive together. Rejected: reading `auth.options.baseURL`, which
  Better Auth types as a string or a dynamic-host object.
- **Root `/.well-known/oauth-authorization-server` proxy** — dropped: the issuer-path form and
  `/api/auth/.well-known/openid-configuration` both answer, which is what RFC 8414 clients probe.

## Interfaces

### Settings (`apps/server/src/config.ts`)

| Variable | Production (`NODE_ENV=production`, as on Vercel) | Otherwise |
|---|---|---|
| `PUBLIC_URL` | required, `https://`, no path, query or trailing slash (`https://sky-brain.vercel.app`) | default `http://localhost:<PORT>` |
| `BETTER_AUTH_SECRET` | required, at least 32 characters | default: a random value per process (sessions do not survive a restart) |
| `PERMINISTER_BASE_URL` | required, `https://`, no path, query or trailing slash | optional |
| `PERMINISTER_CLIENT_ID`, `PERMINISTER_CLIENT_SECRET` | required | optional; without all three Perminister settings there is no `perminister` provider and sign-in fails with Better Auth's error |

`DATABASE_URL`, `MIGRATION_DATABASE_URL` and `MIGRATION_DATABASE_ROLE` stay as D16 set them
(`readConfig` reads only `DATABASE_URL`; the migrate script reads the other two). The product id
`sky-brain` is a constant in `auth/access.ts`, not a setting. Known values that are not secrets
(map.md): the Perminister organization `e3541747-bfab-4fd0-b900-809aa29a099c` (`hamilton-sky`)
and the local-dev client id `10e163a2-1cfe-408d-a6f5-968aa7f46923` (origin `http://localhost`).
Secrets are never written to the repo, tests or logs; tests use made-up values.

Entry point: `readConfig(env: Record<string, string | undefined>): Config` (existing). `Config`
gains `publicUrl`, `betterAuthSecret`, `perministerBaseUrl`, `perministerClientId` and
`perministerClientSecret`, each `string | undefined` (an empty string reads as unset; the
defaults above are applied by `authFromConfig`, not `readConfig`). With `NODE_ENV: "production"`,
`readConfig` throws an `Error` whose message contains the name of the first bad setting
(`PUBLIC_URL`, `BETTER_AUTH_SECRET`, `PERMINISTER_BASE_URL`, `PERMINISTER_CLIENT_ID` or
`PERMINISTER_CLIENT_SECRET`); `start` and `apps/server/src/vercel.ts` call `readConfig` first, so
neither comes up. Outside production it never throws for these.

### Routes this feature adds

| Route | What answers |
|---|---|
| `GET /sign-in`, `GET /consent` | the pages' HTML (`Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`, `Cache-Control: no-store`) |
| `GET /auth-pages/sign-in.js`, `GET /auth-pages/consent.js` | the pages' scripts, same headers, `text/javascript` |
| `GET /auth/perminister/callback` | 302 to `/api/auth/callback/perminister` with the same query string (Perminister's fixed callback path) |
| `/api/auth/*` | Better Auth (`sign-in/social`, `callback/perminister`, `oauth2/authorize`, `oauth2/consent`, `oauth2/token`, `jwks`, its metadata) |
| `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-protected-resource/mcp` | protected resource metadata |
| `GET /.well-known/oauth-authorization-server/api/auth` | authorization server metadata |
| `GET, POST, DELETE /mcp` | MCP streamable HTTP behind the bearer check |

Every path above is under one that `vercel.json` already rewrites to the function (`/sign-in`,
`/consent`, `/auth-pages/*`, `/auth/*`, `/api/*`, `/.well-known/*`, `/mcp`), so no top-level route
is new to the deploy.

### Perminister calls (`apps/server/src/auth/perminister.ts`)

Facts from Perminister's API reference (map.md). The browser goes to
`<PERMINISTER_BASE_URL>/oauth/authorize?response_type=code&client_id=<id>&state=<s>&redirect_uri=<PUBLIC_URL>/auth/perminister/callback&code_challenge_method=S256&code_challenge=<c>`
(Better Auth builds it). The server exchanges the code with
`POST <PERMINISTER_BASE_URL>/api/auth/consumer/token`, headers `Content-Type: application/json`,
`X-Perminister-Client-Id`, `X-Perminister-Client-Secret`, body
`{"grant_type": "authorization_code", "code", "code_verifier"}`, a 10-second timeout. A 200 answer
looks like:

```json
{ "authenticated": true, "sessionToken": "<token>",
  "account": { "subjectId": "<id>", "email": "ann@example.com", "username": null,
               "loginIdentifier": "ann@example.com", "firstName": "Ann", "lastName": null },
  "session": { "expiresAt": "<ISO time>" },
  "organizations": [ { "organizationId": "<uuid>", "organizationName": "<name>",
                       "organizationRole": "member", "productId": "sky-brain",
                       "permissions": [], "resourceRoles": [], "platformAdmin": false } ] }
```

Anything else (a non-200, a body without `account.subjectId`, a timeout) makes `getToken` throw an
`Error` that names only the status, never the body or the secret; Better Auth then redirects to
`/sign-in?error=invalid_code`. `getUserInfo` maps the answer to the profile Better Auth sees:
`subjectId`, `email` (lower-cased by Better Auth), `name` (first and last name, else the email),
`emailVerified: true` (Perminister refuses unverified self-service accounts itself), and
`organizations`. `accountSubject` is `subjectId`.

### The pages (what a test can see without running the script)

The pages have no inline script; each loads its script with
`<script src="/auth-pages/<name>.js" defer>`. Each page's HTML and script live as two exported
strings in `apps/server/src/auth/pages/<name>.ts` (Decisions → Pages ship inside the bundle).

- `GET /sign-in` (any query) answers HTML holding a button `id="perminister"` ("Sign in with
  Perminister")
  and a section `id="no-access" hidden` that already holds the text "No access" and the
  "Try another account" button. `sign-in.js` removes `hidden` from `#no-access` and hides the
  button when the query has an `error` parameter. So "the page says No access" means: the HTML
  of `GET /sign-in?error=no_access` contains `id="no-access"` and `No access`, and
  `GET /auth-pages/sign-in.js` contains `error` and `no-access`.
- `GET /consent` answers HTML holding `id="client-name"`, `id="email"`, `id="redirect-host"`,
  `id="scopes"`, and the buttons `id="allow"` and `id="deny"`. `consent.js` fills
  `#redirect-host` with `new URL(redirect_uri).host` from the page's own query, and every field
  only through `textContent`. So "shows the redirect host" means: the HTML contains
  `id="redirect-host"`, and `GET /auth-pages/consent.js` contains `redirect_uri`, `.host` and
  `textContent` and does not contain `innerHTML`.

### `whoami`

MCP tool, no arguments (any given are ignored). Result: `structuredContent`
`{ "email": string, "user_id": string, "workspaces": [{ "id", "name", "role" }] }` and one text
content block holding the same JSON. `workspaces` lists every workspace the caller is a member of
(their own as `owner`, others with the role of the accepted invite) and none they are not in.

### How a test reaches the server (`apps/server/src/testing/auth-harness.ts`)

```ts
startAuthTestServer(opts: {
  db: Db;                                   // createTestDb()
  cimdDocuments?: Record<string, object>;   // client_id URL -> metadata document; others 404
}): Promise<AuthTestServer>;

interface PerministerAccount {
  subjectId: string;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  productIds?: string[];                    // one organization per id; default ["sky-brain"]
}

interface AuthTestServer {
  url: string;                              // http://127.0.0.1:<port>, also PUBLIC_URL
  perministerUrl: string;                   // "https://perminister.test", the fake's base URL
  setPerministerAccount(a: PerministerAccount): void; // whom the fake signs in next
  approve(authorizeUrl: string): string;    // the fake's /oauth/authorize, see below
  browser(): Browser;                       // a fresh cookie jar
  signJwt(payload: Record<string, unknown>): Promise<string>; // signed with the server's own key
  close(): Promise<void>;
}

interface Browser {
  request(path: string, init?: RequestInit): Promise<TestResponse & { next: string | null }>;
}
```

The harness builds the app with `PERMINISTER_BASE_URL` `perministerUrl`, a made-up client id and
secret, and a `fetch` for Perminister calls that only it serves (every other URL is refused).
`approve(authorizeUrl)` plays the person confirming at Perminister: it throws unless the URL starts
with `<perministerUrl>/oauth/authorize?` and carries the harness's `client_id`,
`response_type=code`, `redirect_uri` exactly `<url>/auth/perminister/callback`,
`code_challenge_method=S256`, a `code_challenge` and a `state`, and no client secret anywhere;
then it returns the path `/auth/perminister/callback?code=<new code>&state=<the state>`, the code
bound to the current account and to that challenge. The fake token endpoint answers 200 with the
shape in Perminister calls only when the client headers match, the body is
`grant_type=authorization_code` JSON, the code was issued by `approve`, is unused and under 5
minutes old, and `code_verifier` hashes (S256) to its challenge; otherwise 400
`{"error": "invalid_grant"}`. A code is used up by its first exchange, good or bad.

`Browser.request` sends the jar's cookies and `Origin: <url>` (Better Auth refuses a state-changing
request without it), never follows redirects, stores `Set-Cookie`, and sets `next` to the
`Location` header or, when Better Auth answers a fetch with `200 {"redirect": true, "url"}`, to
that `url`. `TestResponse` is brain-core's (`status`, `headers`, `body`, `text`).

The flow a test drives, with `b = server.browser()`:

1. `b.request("/api/auth/oauth2/authorize?" + query)` (`response_type=code`, `client_id`,
   `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `state`, `scope`,
   `resource=<url>/mcp`) → `next` starts with `/sign-in?`.
2. `b.request("/api/auth/sign-in/social", {method: "POST", JSON {provider: "perminister",
   callbackURL: "/", errorCallbackURL: "/sign-in", oauth_query: <query of next>}})` → `body.url`
   starts with `<perministerUrl>/oauth/authorize?`.
3. `b.request(server.approve(body.url))` → `next` is `/api/auth/callback/perminister?code=...&state=...`;
   `b.request(next)` → `next` is `/consent?...` (or the client redirect when consent was already
   given; `/sign-in?error=no_access` or `/sign-in?error=email_not_found` when refused). A plain
   sign-in without an OAuth client drives the same steps with no `oauth_query` and ends with the
   session cookie set and `next` `/`.
4. `b.request("/api/auth/oauth2/consent", {method: "POST", JSON {accept: true, oauth_query}})` →
   `next` is `<redirect_uri>?code=...&state=...&iss=...`.
5. `POST /api/auth/oauth2/token` form-urlencoded (`grant_type=authorization_code`, `code`,
   `redirect_uri`, `client_id`, `code_verifier`) → `access_token`, `refresh_token`.
6. `POST /mcp` with `Authorization: Bearer`, `Accept: application/json, text/event-stream`, a
   JSON-RPC `initialize` then `tools/call` `whoami`. The answer may be an SSE body
   (`event: message\ndata: {...}`).

## Migration and compatibility

- Migration `0002` adds Better Auth's tables (`user`, `session`, `account`, `verification`,
  `jwks`, `rate_limit`, `oauth_client`, `oauth_resource`, `oauth_client_resource`,
  `oauth_refresh_token`, `oauth_access_token`, `oauth_consent`, `oauth_client_assertion`, or
  whatever names the CLI generates for that plugin set). On Vercel it runs in the build for
  production deploys, as D16 set up. No existing table changes;
  `members.user_id` and `devices.user_id` stay `text` with no foreign key and hold Better Auth
  user ids (32 characters of `[A-Za-z0-9]`, which fit `UserIdSchema`).
- `createApp`'s new `auth` option is optional: brain-core's tests and acceptance tests, which call
  `createApp` and `startTestServer` without it, keep working and get no auth routes.
- The `X-Dev-Actor` header keeps its D15 behaviour and still wins over the session in development.

## Risks

- Better Auth's MCP packages move fast — pin exact versions (`better-auth`, `@better-auth/mcp`,
  `@better-auth/cimd` 1.7.15, `@modelcontextprotocol/server` 2.4.0) and record them in CLAUDE.md.
- A stranger's CIMD URL makes the server fetch it (SSRF) — production uses the resolve-once
  transport from `@better-auth/cimd/node` and its default fetch budgets.
- Consent clickjacking or a misleading client name — `frame-ancestors 'none'`, the redirect host
  shown plainly, CIMD text set only with `textContent`.
- Cold start breaking claude.ai's 10-second wait on discovery and token calls — a Vercel function
  cold start plus the first Nanogres connect must stay well under it (D16 Watch); the manual check
  in ticket 07 measures it. Nothing is left to settle about the host (ticket 01).
- PgBouncer may run in transaction mode — no `LISTEN`, no session advisory locks, no `SET`
  outside a transaction, no named prepared statements across transactions. Drizzle's
  node-postgres driver and Better Auth's Drizzle adapter use unnamed statements and `BEGIN`/
  `COMMIT` on one client; `SET ROLE` stays in the migrate script on the session port (D16).
- Perminister is down or slow — sign-in fails with `invalid_code` after 10 s; tokens already
  issued keep working, since `/mcp` checks only our own JWTs.
- Bundling: the Vercel function is one esbuild bundle; the repair spike bundled `better-auth`,
  its plugins, `@better-auth/mcp`, `@better-auth/cimd/node` and `@modelcontextprotocol/server`
  with the current externals and they loaded (map.md).
- claude.ai's real behaviour cannot be tested offline — the bar's second half is a manual check
  after deploy, written into `docs/CONNECT.md`.

## UI

### Sign-in — default

```
┌──────────────────────────────────┐
│  sky-brain                       │
│                                  │
│  Sign in to continue to Claude.  │
│                                  │
│  [ Sign in with Perminister ]    │
└──────────────────────────────────┘
```

### Sign-in — refused (`/sign-in?error=no_access`)

```
┌──────────────────────────────────┐
│  sky-brain                       │
│                                  │
│  No access                       │
│  This account has no access to   │
│  sky-brain. Ask the owner for an │
│  invitation in Perminister.      │
│                                  │
│  [ Try another account ]         │
└──────────────────────────────────┘
```

### Consent

```
┌──────────────────────────────────┐
│  sky-brain                       │
│                                  │
│  Claude wants to use sky-brain   │
│  as ann@example.com.             │
│                                  │
│  It will return you to:          │
│  claude.ai                       │
│                                  │
│  Access: read, write             │
│                                  │
│  [ Allow ]   [ Deny ]            │
└──────────────────────────────────┘
```
