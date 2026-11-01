# login-mcp — Spec

## Problem

brain-core (tickets 01 to 04 on `claude/brain-core`) knows only one caller: the dev-only
`X-Dev-Actor` header, honoured when `NODE_ENV=development` and on 127.0.0.1 (D15). `createApp`
gets `resolveActor` defaulting to `() => undefined`, so outside the developer's own machine every
`/api/v1` request is 401 and there is no `/mcp` at all. Nobody can sign in, and claude.ai, the
Claude phone app and Claude Code cannot add sky-brain as a connector.

This feature is steps 3 to 8 of `docs/layer-1/LOGIN-MCP-PLAN.md` (Layer 1 tickets T0, the core of
T3 and the first cut of T6): people sign in with Google, sky-brain becomes its own OAuth 2.1
authorization server (Google is only the sign-in page behind it), and `/mcp` serves MCP over
streamable HTTP to clients that hold one of its access tokens, acting as the signed-in person.

## Goal and the bar

Done means a person on the allowlist (`ALLOWED_EMAILS`, or the bootstrap owner) can sign in with
Google and gets their own workspace, and an MCP client that registers with a Client ID Metadata Document (CIMD) can run the whole OAuth 2.1 +
PKCE flow and call `whoami` on `/mcp`, getting back the signed-in person's email and every workspace they belong to.

Brief decisions this spec carries (Decided lines): each person who signs in gets their own board,
a personal workspace with them as owner, created at first sign-in, with the workspace (global)
scope on top and projects and features under it; workspaces stay walled off (hard rule 4); an
invite adds a person to another owner's workspace and also works for someone who already has an
account; `whoami` lists every workspace the caller belongs to; who may sign in at all is the
`ALLOWED_EMAILS` allowlist plus `BOOTSTRAP_OWNER_EMAIL` (shammai confirmed the allowlist over any
Google account), checked in one function so it can be opened later. sky-brain is Pathly's knowledge
board in the cloud without CLI spawning (D1); tasks, claims and their state machine stay in Pathly
(D3), and a cloud task board is a separate later feature.

**The bar.**

1. `pnpm test` exits 0 and includes tests that drive the whole claude.ai flow against the app
   with Google mocked: `/mcp` without a token answers 401 with a `resource_metadata` challenge;
   the discovery documents carry the exact `resource`, issuer, `S256`, `none` and
   `client_id_metadata_document_supported: true`; a CIMD client completes authorize → token
   with PKCE to `https://claude.ai/api/mcp/auth_callback`; a loopback redirect on any port is
   accepted; and `whoami` returns the email of the person the token was issued to.
2. After deploy with shammai's Google client, claude.ai's `whoami` returns shammai's email
   (a manual check, recorded in `docs/CONNECT.md`).

## Stories

### A person signs in with Google

**As** a person on the allowlist, **I want** to sign in with my Google account, **so that**
sky-brain knows who I am, gives me my own board, and lets me into the workspaces I was invited to.

- [ ] `GET /sign-in` answers 200 `text/html` with a "Sign in with Google" button.
- [ ] Signing in with an email in `ALLOWED_EMAILS` or equal to `BOOTSTRAP_OWNER_EMAIL` (any case)
      creates that person, one workspace of their own and an `owner` membership in it. Signing in
      again creates no second workspace and no second membership.
- [ ] Two allowed people who sign in get two workspaces, and neither can see the other's:
      each one's `whoami` (Interfaces → `whoami`, reached through `startAuthTestServer` and the
      flow in Interfaces) lists exactly one workspace, their own as `owner`, and the two `id`s
      differ (hard rule 4).
- [ ] An allowed person with a pending row in `invites` gets, at sign-in, a `members` row with the
      invite's role in that workspace, and the invite's `accepted_at` is set. This holds for a
      first sign-in and for a person who already had an account when the invite was made.
- [ ] Signing in with any other email (including one that has only an invite, or a Google
      profile whose `email_verified` is not true) creates no user and no session: the browser
      lands on `/sign-in?error=no_access` and the page says "No access".
- [ ] A person taken off `ALLOWED_EMAILS` gets "No access" at their next sign-in.
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
      `https://claude.ai/api/mcp/auth_callback` completes authorize → Google sign-in → consent →
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
- Better Auth 1.7.15 with Google, `jwt()`, `mcp()` (`@better-auth/mcp` 1.7.15) and `cimd()`
  (`@better-auth/cimd` 1.7.15), on the existing Drizzle database (PGlite in tests and dev,
  Postgres in production), with its tables in a new migration.
- `ALLOWED_EMAILS` and `BOOTSTRAP_OWNER_EMAIL` decide who may sign in; a personal workspace per
  person at first sign-in; invite acceptance on every sign-in; "No access" for everyone else.
- A session-cookie `ActorResolver` for `/api/v1`, and a bearer-JWT resolver for `/mcp`
  (audience `<PUBLIC_URL>/mcp`).
- `/sign-in` and `/consent` pages.
- `/mcp` over streamable HTTP (`@modelcontextprotocol/server` 2.4.0) with `whoami`. The six Layer
  1 tools come as brain-core's routes land (see Not in scope).
- `render.yaml` env vars for auth, `docs/CONNECT.md`, and a decision on free vs paid Render.

Not in scope:
- The scaffold and PGlite harness: brain-core 01 and 02 built them.
- The six Layer 1 MCP tools (`context`, `search`, `get`, `post`, `supersede`, `ask`): brain-core
  05 to 10 have not built their routes yet; each tool is added in a later round on top of the
  service layer those tickets build (T6 proper).
- An owner-facing invite route: T3's invite UI and route belong with T8 (web page) and T4's
  human-only routes; tests seed `invites` rows directly.
- Device login and run tokens: T7. The web page: T8. The Pathly client: T10.
- Dynamic client registration: off, as the brief says.
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
5. The person presses "Sign in with Google" → the page posts the signed query to
   `/api/auth/sign-in/social` → Google → `/api/auth/callback/google` → `mayEnter` lets an
   allowlisted (or bootstrap) email in → the sign-in hook gives a first-time person their own
   workspace and accepts pending invites → Better Auth resumes the authorization and sends the person
   to `/consent?<signed query>`.
6. The consent page shows the client name and the redirect host → the person presses Allow →
   `/api/auth/oauth2/consent` → redirect to `https://claude.ai/api/mcp/auth_callback?code=...`.
7. claude.ai swaps the code at `/api/auth/oauth2/token` (form-urlencoded, PKCE verifier) → JWT
   access token (audience `<PUBLIC_URL>/mcp`) and refresh token.
8. claude.ai calls `whoami` on `/mcp` with `Authorization: Bearer <jwt>` → the email and
   every workspace of the person the token's `sub` names.

## Edge cases

| Trigger | Expected behaviour | Handled in ticket |
|---|---|---|
| Email not in `ALLOWED_EMAILS` and not the bootstrap owner | No user, no session; `/sign-in?error=no_access` shows "No access" | 03 |
| Email with an invite but not on the allowlist | Same as above; the invite stays pending | 03 |
| Allowed person taken off the list later | "No access" at the next sign-in (existing sessions and tokens run out on their own expiry) | 03 |
| Google says `email_verified: false` | Same as not allowed | 03 |
| A person signs in a second time | No new workspace, no new membership | 03 |
| Invite made after the person already has an account | Accepted at their next sign-in | 03 |
| Email in another case (`Ann@X.com` vs `ann@x.com`) on the list or an invite | Matches | 03 |
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
| `NODE_ENV=production` without `PUBLIC_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET`, or `PUBLIC_URL` not HTTPS | `readConfig` throws naming the setting, so the server never starts (Interfaces → Settings) | 02 |
| `X-Dev-Actor` with the dev header off | Still 401 `dev_actor_disabled` (D15), even with a valid session | 03 |

## Design

```
 browser ──cookie──► /sign-in, /consent (static pages, CSP)
    │                       │ fetch
    ▼                       ▼
 /api/auth/* ──────► Better Auth (google, jwt, mcp, cimd)
 /.well-known/* ───►   │  mayEnter (allowlist), onSignIn (own workspace, invites)
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
`/{*splat}` catch-all, which would otherwise shadow it.

### Decisions

- **Who may sign in** (brief, `Decided:`: shammai confirmed the allowlist, and the allowlist is
  the only gate, the recommended option on shammai's card) — options: A, the `ALLOWED_EMAILS`
  allowlist plus `BOOTSTRAP_OWNER_EMAIL`, and an invite alone does not admit anyone (it adds a
  person who is already allowed to another owner's workspace); B, the same allowlist, and an email
  with a pending invite may also sign in ("invite also admits"); C, any verified Google account.
  Chosen: A, as the brief decides. Rejected: B and C. The whole rule is one function, `mayEnter`
  (`auth/access.ts`), so if shammai picks B on the card, `mayEnter` also allows an email with a
  pending invite and nothing else changes.
- **Where sign-in refuses** — options: A, Better Auth's `user.validateUserInfo`, which runs before
  the user is created and on every later Google sign-in with the fresh profile; B,
  `databaseHooks.user.create.before`, which runs once. Chosen: A. Why: least privilege (a refused
  person gets no user row, session or token for `/mcp`), and taking someone off the list takes
  effect at their next sign-in. The round 3 spike showed A redirects to the `errorCallbackURL`
  with `?error=no_access` and writes no session.
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
- **Mocking Google** — options: A, wrap `globalThis.fetch` in tests so
  `https://oauth2.googleapis.com/token` returns a token response whose `id_token` carries the
  chosen profile; B, Better Auth's `testUtils` plugin to create sessions directly. Chosen: A.
  Why: it runs the real `/api/auth/callback/google` route and `mayEnter`; B skips both.
- **CIMD transport** — production uses `fetchClientMetadataResource` from `@better-auth/cimd/node`
  (resolves once, refuses non-public addresses and redirects); tests inject a fake that serves
  fixture documents. The fake is reachable only through the test harness's `createApp` options.
- **Default `PUBLIC_URL` outside production** — options: A, `http://127.0.0.1:<PORT>` from the
  config, so the auth instance and `createApp` are built before `listen` as today; B, listen
  first and build them from the bound port. Chosen: A. Why: `start` keeps its shape; port 0 is
  only used by tests, and the test harness sets its own URL.
- **How `createApp` learns the public URL** — `AppOptions.auth` is `{ instance: Auth; publicUrl:
  string }`, so the two always arrive together. Rejected: reading `auth.options.baseURL`, which
  Better Auth types as a string or a dynamic-host object.
- **Root `/.well-known/oauth-authorization-server` proxy** — dropped: the issuer-path form and
  `/api/auth/.well-known/openid-configuration` both answer, which is what RFC 8414 clients probe.

## Interfaces

### Settings (`apps/server/src/config.ts`)

| Variable | Production | Otherwise |
|---|---|---|
| `PUBLIC_URL` | required, `https://`, no path, query or trailing slash | default `http://127.0.0.1:<PORT>` |
| `BETTER_AUTH_SECRET` | required, at least 32 characters | default: a random value per process (sessions do not survive a restart) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | required | optional; without them Google sign-in fails with Better Auth's error |
| `BOOTSTRAP_OWNER_EMAIL` | optional; always allowed to sign in | optional |
| `ALLOWED_EMAILS` | optional, comma separated; empty means only the bootstrap owner | optional |

Entry point: `readConfig(env: Record<string, string | undefined>): Config` (existing). `Config`
gains `publicUrl`, `betterAuthSecret`, `googleClientId`, `googleClientSecret` and
`bootstrapOwnerEmail`, each `string | undefined`, and `allowedEmails: string[]` (each entry trimmed
and lower-cased, empty entries dropped; the bootstrap email is lower-cased too; an empty string
reads as unset; the defaults
above are applied by `start`, not `readConfig`). With `NODE_ENV: "production"`, `readConfig`
throws an `Error` whose message contains the name of the first bad setting (`PUBLIC_URL`,
`BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET`); `start` calls `readConfig`
first, so the server never listens. Outside production it never throws for these.

### Routes this feature adds

| Route | What answers |
|---|---|
| `GET /sign-in`, `GET /consent` | static HTML (`Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`, `Cache-Control: no-store`) |
| `GET /auth-pages/sign-in.js`, `GET /auth-pages/consent.js` | the pages' scripts, same headers, `text/javascript` |
| `/api/auth/*` | Better Auth (sign-in, Google callback, `oauth2/authorize`, `oauth2/consent`, `oauth2/token`, `jwks`, its metadata) |
| `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-protected-resource/mcp` | protected resource metadata |
| `GET /.well-known/oauth-authorization-server/api/auth` | authorization server metadata |
| `GET, POST, DELETE /mcp` | MCP streamable HTTP behind the bearer check |

### The pages (what a test can see without running the script)

The pages have no inline script; each loads its script with
`<script src="/auth-pages/<name>.js" defer>`.

- `GET /sign-in` (any query) answers HTML holding a button `id="google"` ("Sign in with Google")
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
  bootstrapOwnerEmail?: string;
  allowedEmails?: string[];                 // default []
  cimdDocuments?: Record<string, object>;   // client_id URL -> metadata document; others 404
}): Promise<AuthTestServer>;

interface AuthTestServer {
  url: string;                              // http://127.0.0.1:<port>, also PUBLIC_URL
  setGoogleUser(p: { email: string; sub?: string; emailVerified?: boolean; name?: string }): void;
  browser(): Browser;                       // a fresh cookie jar
  signJwt(payload: Record<string, unknown>): Promise<string>; // signed with the server's own key
  close(): Promise<void>;
}

interface Browser {
  request(path: string, init?: RequestInit): Promise<TestResponse & { next: string | null }>;
}
```

`Browser.request` sends the jar's cookies and `Origin: <url>` (Better Auth refuses a state-changing
request without it), never follows redirects, stores `Set-Cookie`, and sets `next` to the
`Location` header or, when Better Auth answers a fetch with `200 {"redirect": true, "url"}`, to
that `url`. `TestResponse` is brain-core's (`status`, `headers`, `body`, `text`).

The flow a test drives, with `b = server.browser()`:

1. `b.request("/api/auth/oauth2/authorize?" + query)` (`response_type=code`, `client_id`,
   `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `state`, `scope`,
   `resource=<url>/mcp`) → `next` starts with `/sign-in?`.
2. `b.request("/api/auth/sign-in/social", {method: "POST", JSON {provider: "google",
   callbackURL: "/", errorCallbackURL: "/sign-in", oauth_query: <query of next>}})` → `body.url`
   is Google's, with a `state`.
3. `b.request("/api/auth/callback/google?code=x&state=<state>")` → `next` is `/consent?...`
   (or the client redirect when consent was already given; `/sign-in?error=no_access` when refused).
4. `b.request("/api/auth/oauth2/consent", {method: "POST", JSON {accept: true, oauth_query}})` →
   `next` is `<redirect_uri>?code=...&state=...&iss=...`.
5. `POST /api/auth/oauth2/token` form-urlencoded (`grant_type=authorization_code`, `code`,
   `redirect_uri`, `client_id`, `code_verifier`) → `access_token`, `refresh_token`.
6. `POST /mcp` with `Authorization: Bearer`, `Accept: application/json, text/event-stream`, a
   JSON-RPC `initialize` then `tools/call` `whoami`. The answer may be an SSE body
   (`event: message\ndata: {...}`).

## Migration and compatibility

- Migration `0002` adds Better Auth's tables (`user`, `session`, `account`, `verification`,
  `jwks`, `oauth_client`, `oauth_resource`, `oauth_client_resource`, `oauth_refresh_token`,
  `oauth_access_token`, `oauth_consent`, `oauth_client_assertion`). No existing table changes;
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
- Cold start or free-tier sleep breaking claude.ai's 10-second OAuth wait — settled in ticket 01.
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
│  [ Sign in with Google ]         │
└──────────────────────────────────┘
```

### Sign-in — refused (`/sign-in?error=no_access`)

```
┌──────────────────────────────────┐
│  sky-brain                       │
│                                  │
│  No access                       │
│  This Google account is not on   │
│  sky-brain's list. Ask the owner │
│  to add it.                      │
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
