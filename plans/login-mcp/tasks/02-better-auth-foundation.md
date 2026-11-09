# Add Better Auth with Perminister sign-in, its tables, settings and discovery routes, the Vercel wiring and the auth test harness

Type: task
Status: resolved
Blocked by: —
Test first: yes
Level: 3
Touches: apps/server/package.json, pnpm-lock.yaml, apps/server/src/auth/auth.ts, apps/server/src/auth/perminister.ts (new), apps/server/src/auth/perminister.test.ts (new), apps/server/src/auth/from-config.ts (new), apps/server/src/auth/routes.ts, apps/server/src/auth/cli-config.ts, apps/server/src/auth/discovery.test.ts, apps/server/src/db/auth-schema.ts, apps/server/src/db/schema.ts, apps/server/drizzle/, apps/server/src/config.ts, apps/server/src/config.test.ts, apps/server/src/server.ts, apps/server/src/server.test.ts, apps/server/src/vercel.ts, apps/server/src/app.ts, apps/server/src/testing/auth-harness.ts (new), apps/server/src/testing/fake-perminister.ts (new), apps/server/src/auth/pages/sign-in.ts (new), apps/server/src/auth/pages/consent.ts (new), CLAUDE.md

The base every other ticket builds on: Better Auth inside the app, on the existing database, with
"Sign in with Perminister" as its only sign-in and the OAuth server metadata answering at the exact
paths claude.ai reads, in `pnpm dev`, in tests and in the Vercel function. Follow map.md's spike
lines (the round 1 to 3 ones for `mcp()`, `cimd()` and `jwt()`, the repair ones for Perminister and
bundling); they were run against these exact versions. There is no Google provider anywhere.

**Packages** (`apps/server/package.json`, exact pins): `better-auth` 1.7.15, `@better-auth/mcp`
1.7.15, `@better-auth/cimd` 1.7.15 and `@modelcontextprotocol/server` 2.4.0 as dependencies (the
MCP SDK is added here so ticket 05 need not touch the lockfile), and the Better Auth CLI `auth`
1.7.15 as a dev dependency. Check that pnpm resolves the peers `better-call` 1.4.4 and
`@better-auth/core` 1.7.15 without a warning; add them as direct dependencies only if it does not.

**Tables.** Generate Better Auth's Drizzle tables with the CLI
(`pnpm --filter @sky-brain/server exec auth generate --config src/auth/cli-config.ts --adapter
drizzle --dialect postgresql --output src/db/auth-schema.ts -y`). `cli-config.ts` (new) exports a
`betterAuth({...})` with the same plugins as `createAuth` and placeholder values, used only by the
CLI; give `auth-schema.ts` a header comment naming that command. `schema.ts` re-exports it
(`export * from "./auth-schema.ts"`) so the `Db` type and drizzle-kit see the tables. Then
`pnpm --filter @sky-brain/server exec drizzle-kit generate --name auth` writes the new `drizzle/0002_auth.sql`;
never hand-edit it. No existing table changes.

**Settings** (`config.ts`), as spec.md Interfaces → Settings: `Config` gains `publicUrl`,
`betterAuthSecret`, `perministerBaseUrl`, `perministerClientId` and `perministerClientSecret` (all
`string | undefined`; empty means unset), read from `PUBLIC_URL`, `BETTER_AUTH_SECRET`,
`PERMINISTER_BASE_URL`, `PERMINISTER_CLIENT_ID`, `PERMINISTER_CLIENT_SECRET`. With
`NODE_ENV=production`, `readConfig` throws an error naming the first setting that is missing, a
`PUBLIC_URL` or `PERMINISTER_BASE_URL` that is not `https://` with no path, query or trailing
slash, or a `BETTER_AUTH_SECRET` under 32 characters. Update the existing production case in
`config.test.ts` ("reads DATABASE_URL, PGLITE_DATA_DIR and NODE_ENV") to pass the new settings.
No `GOOGLE_*`, `ALLOWED_EMAILS` or `BOOTSTRAP_OWNER_EMAIL`.

**Perminister** (`auth/perminister.ts`, new), as spec.md Interfaces → Perminister calls:
`perministerProvider({ baseUrl, clientId, clientSecret, publicUrl, fetch })` returns the
`genericOAuth` config entry: `providerId: "perminister"`, `name: "Perminister"`, `clientId`,
`clientSecret`, `authorizationUrl: baseUrl + "/oauth/authorize"`, `redirectURI: publicUrl +
"/auth/perminister/callback"`, `pkce: true`, `accountSubject: ({ profile }) => profile.subjectId`,
`getToken` (the exchange: `POST baseUrl + "/api/auth/consumer/token"` through the given `fetch`,
JSON body `{ grant_type: "authorization_code", code, code_verifier }`, the two
`X-Perminister-Client-*` headers, `AbortSignal.timeout(10_000)`; returns `{ accessToken:
sessionToken, accessTokenExpiresAt, raw: <the answer> }`; throws an `Error` naming only the status
on anything else, never logging the body or the secret) and `getUserInfo` (maps `tokens.raw` to
`{ id: subjectId, subjectId, email, name, emailVerified: true, organizations }`, or null without a
`subjectId`). Write it from Perminister's API reference (map.md); do not copy the unlicensed
visitoring client. Unit tests (`auth/perminister.test.ts`, new) call `getToken` and `getUserInfo`
with a stub `fetch`.

**The auth instance** (`auth/auth.ts`, new): `createAuth({ db, publicUrl, secret, perminister?,
fetchClientMetadataResource })`, where `perminister` is `{ baseUrl, clientId, clientSecret,
fetch }`, returns `betterAuth({ baseURL: publicUrl, basePath: "/api/auth", secret, database:
drizzleAdapter(db, { provider: "pg", schema }), account: { encryptOAuthTokens: true }, rateLimit:
{ storage: "database" }, plugins: [jwt(), ...(perminister ? [genericOAuth({ config:
[perministerProvider({ ...perminister, publicUrl })] })] : []), mcp({ loginPage: "/sign-in",
consentPage: "/consent", resource: publicUrl + "/mcp", scopes: ["openid", "profile", "email",
"offline_access", "brain:read", "brain:write"] }), cimd({ fetchClientMetadataResource,
metadataProfile: "mcp-2026-07-28" })] })`. No `socialProviders`, no `oauthProvider()` next to
`mcp()`, no dynamic registration options. Export its type as `Auth`. Ticket 03 adds the access
rule and the sign-in hook to this same call.

**One builder for every entry point** (`auth/from-config.ts`, new): `authFromConfig(config, db,
overrides?)` returns `{ instance, publicUrl }` for `AppOptions.auth`: `publicUrl` is
`config.publicUrl` or `http://localhost:<config.port>` (spec.md Decisions); the secret is
`config.betterAuthSecret` or, outside production only, a random 32-byte value per process; the
Perminister provider is on only when all three Perminister settings are set, with the global
`fetch`; `fetchClientMetadataResource` is the one from `@better-auth/cimd/node`. `overrides` lets
the harness pass its own `publicUrl`, Perminister `fetch` and CIMD fetch.

**Routes** (`auth/routes.ts`, new): `mountAuth(app, auth)` mounts `toNodeHandler(auth)` on
`/api/auth/*splat`, `GET /.well-known/oauth-protected-resource`,
`GET /.well-known/oauth-protected-resource/mcp` and
`GET /.well-known/oauth-authorization-server/api/auth`; answers
`GET /auth/perminister/callback` with a 302 to `/api/auth/callback/perminister` plus the request's
own query string (map.md repair spike); and serves `GET /sign-in`, `GET /consent` and
`GET /auth-pages/<name>.js` from the page modules in `src/auth/pages/` (`sign-in.ts` and
`consent.ts`, each exporting `html` and `script` strings, imported statically by `routes.ts`).
This ticket creates both modules as stubs exporting empty strings, and an empty string answers
404; tickets 03 and 04 fill in their own module only, so neither touches `routes.ts`. The
headers apply to every page and script: `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'` and
`Cache-Control: no-store` (spec.md Decisions → Pages ship inside the bundle: no files read from
disk, because the Vercel bundle does not carry them). `AppOptions` gains an optional `auth: {
instance: Auth; publicUrl: string }` and, when given, `createApp` calls `mountAuth(app,
options.auth.instance)` right after `/healthz`, before `/api/v1`, the `/api` 404,
`express.static` and `/{*splat}`.

**Start and Vercel.** `server.ts` passes `auth: authFromConfig(config, db)` to `createApp`;
update `server.test.ts` for the new `Config` fields. `vercel.ts` passes `auth:
authFromConfig(config, db)` the same way (it already calls `readConfig`, which now refuses a
production start without the auth settings). Do not change `vercel.json`, `api/index.mjs` or the
`build:vercel` externals: every route is under an existing rewrite, and the bundle spike loaded
all the auth packages with the current flags (map.md). Nothing may rely on process memory across
requests (spec.md Decisions → Serverless).

**Harness** (`testing/auth-harness.ts` and `testing/fake-perminister.ts`, new):
`startAuthTestServer` exactly as spec.md Interfaces → How a test reaches the server says: it
listens on `127.0.0.1:0`, uses that URL as `publicUrl`, builds the instance through
`authFromConfig` with overrides (made-up client id and secret, `perministerUrl`
`https://perminister.test`, the fake's `fetch`, and a fake `fetchClientMetadataResource` that
serves `cimdDocuments`, 404 for any other URL), and implements `setPerministerAccount`,
`approve` (every check spec.md lists), `browser()` and `signJwt` (through `auth.api.signJWT({
body: { payload } })`, which returns `{ token }`; map.md). It does not touch `globalThis.fetch`.
It passes `auth: { instance, publicUrl: url }` to `createApp`. Who may sign in, personal
workspaces and invites are ticket 03's; until then any account the fake signs in gets a user and
a session.

**Docs.** No decision here: this setup (versions, issuer, resource, CIMD on, DCR off, Perminister
through `genericOAuth`) is recorded in the "T0 result" decision (ticket 07). CLAUDE.md's Commands
section lists the five new environment variables (`PUBLIC_URL`, `BETTER_AUTH_SECRET`,
`PERMINISTER_BASE_URL`, `PERMINISTER_CLIENT_ID`, `PERMINISTER_CLIENT_SECRET`, with the local-dev
note that `PUBLIC_URL` defaults to `http://localhost:<PORT>` to match the local Perminister
client) and the schema command, and records the pinned versions (the CLI flags are in map.md).
Never write a client secret anywhere.

Tests (`src/auth/discovery.test.ts`, new, through the harness, plus `config.test.ts`):
- "discovery: protected resource metadata names the /mcp resource and the issuer" — both paths,
  `resource` exactly `<url>/mcp`, `authorization_servers[0]` exactly `<url>/api/auth`.
- "discovery: authorization server metadata advertises S256, none and CIMD" — issuer,
  `code_challenge_methods_supported` `["S256"]`, `"none"` in `token_endpoint_auth_methods_supported`,
  `client_id_metadata_document_supported: true`.
- "discovery: dynamic client registration is off" — no `registration_endpoint`, and
  `POST /api/auth/oauth2/register` is not 2xx.
- "discovery: auth routes are not shadowed by the /api 404 or the web catch-all" —
  `GET /api/auth/jwks` answers 200 with a `keys` array.
- "discovery: the Perminister callback forwards to Better Auth with the same query" —
  `GET /auth/perminister/callback?code=c&state=s` answers 302 with `Location`
  `/api/auth/callback/perminister?code=c&state=s`.
- "perminister: sign-in sends the browser to Perminister with PKCE and no secret" — through the
  harness, `sign-in/social` with `provider: "perminister"` answers a `url` that `approve` accepts
  (so `client_id`, `redirect_uri`, `S256`, `state` are right) and that does not contain the
  harness's client secret.
- "perminister: a callback signs the person in and keys the account by subjectId" — the full
  plain sign-in of spec.md Interfaces step 3: session cookie set, one `user` row, one `account`
  row with `provider_id` `perminister` and `account_id` the `subjectId`, and the stored
  `access_token` is not the plain `sessionToken` (encrypted).
- "perminister: getToken sends the client headers and names only the status on failure" (unit,
  stub `fetch`): the request has both `X-Perminister-Client-*` headers and the JSON body; a 400
  answer throws an error whose message has `400` and not the secret.
- `readConfig`: "refuses production without PUBLIC_URL", "refuses a PUBLIC_URL that is not https
  in production", "refuses production without BETTER_AUTH_SECRET", "refuses production without
  the Perminister client" (each of the three Perminister settings), "refuses a PERMINISTER_BASE_URL
  that is not https in production", and the allowed case "reads the auth settings".

## Not in this ticket

- Who may sign in (`mayEnter`, "No access"), personal workspaces, invites and the session
  resolver: ticket 03.
- The sign-in and consent pages themselves: tickets 03 and 04.
- `/mcp` and the bearer check: ticket 05.
- The Vercel environment variable list and the new `docs/CONNECT.md`: ticket 06. `vercel.json`
  and `api/index.mjs` do not change.

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/auth src/config src/server --reporter=verbose`
  passes and its output contains the `prints` lines below.
- `pnpm --filter @sky-brain/server exec drizzle-kit generate` prints `No schema changes` (schema.ts
  and the migrations agree).
- The Vercel bundle still builds with the auth packages in it:
  `pnpm --filter @sky-brain/server build:vercel` prints `vercel.mjs`.
- `node tools/dev-smoke.mjs` prints `healthz 200` (`pnpm dev` still starts with no auth settings).
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/auth src/config src/server --reporter=verbose
prints discovery: protected resource metadata names the /mcp resource and the issuer
prints discovery: authorization server metadata advertises S256, none and CIMD
prints discovery: dynamic client registration is off
prints discovery: auth routes are not shadowed by the /api 404 or the web catch-all
prints discovery: the Perminister callback forwards to Better Auth with the same query
prints perminister: sign-in sends the browser to Perminister with PKCE and no secret
prints perminister: a callback signs the person in and keys the account by subjectId
prints perminister: getToken sends the client headers and names only the status on failure
prints refuses production without PUBLIC_URL
prints refuses a PUBLIC_URL that is not https in production
prints refuses production without the Perminister client
prints refuses a PERMINISTER_BASE_URL that is not https in production
$ pnpm --filter @sky-brain/server exec drizzle-kit generate
prints No schema changes
$ pnpm --filter @sky-brain/server build:vercel
prints vercel.mjs
$ node tools/dev-smoke.mjs
prints healthz 200
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Interfaces, § Design, § Migration and compatibility.
- map.md § Decisions so far (the spike lines and the real exports).
- `apps/server/src/app.ts` (route order), `apps/server/src/db/client.ts`, `apps/server/src/vercel.ts`,
  `apps/server/src/testing/harness.ts` (reuse `TestResponse`), `plans/brain-core/learnings.md`
  (drizzle-kit and prettier notes); read-only: `vercel.json`, `api/index.mjs`,
  `docs/layer-1/LOGIN-MCP-PLAN.md`, `docs/DECISIONS.md` D16.

## Answer

Work started at `7ac098c6f9936abbb4fb12068fadfdc37e3303b5`; the failing tests were committed alone
first (`test(login-mcp): 02 failing test`).

- **Built**:
  - `apps/server/package.json`, `pnpm-lock.yaml`: `better-auth`, `@better-auth/mcp`,
    `@better-auth/cimd`, `@better-auth/oauth-provider` 1.7.15 and `@modelcontextprotocol/server`
    2.4.0 as dependencies, `auth` 1.7.15 as a dev dependency, all exact.
  - `apps/server/src/auth/`: `auth.ts` (`createAuth`, `Auth`, `MCP_SCOPES`), `perminister.ts`
    (`perministerProvider`), `from-config.ts` (`authFromConfig`, `AuthOverrides`, `AppAuth`),
    `routes.ts` (`mountAuth`), `cli-config.ts`, `pages/sign-in.ts` and `pages/consent.ts` (stubs
    exporting empty `html` and `script`), tests `perminister.test.ts` and `discovery.test.ts`.
  - `apps/server/src/db/auth-schema.ts` (CLI output plus a header comment naming the command),
    `schema.ts` re-exports it, `drizzle/0002_auth.sql` + `meta/0002_snapshot.json` +
    `meta/_journal.json` from `drizzle-kit generate --name auth` (13 new tables, no existing table
    changed, not hand-edited).
  - `config.ts` (+ the five settings and the production checks), `config.test.ts`,
    `server.ts`, `server.test.ts`, `vercel.ts`, `app.ts` (optional `auth`, mounted right after
    `/healthz`).
  - `apps/server/src/testing/auth-harness.ts` (`startAuthTestServer`, `Browser`,
    `TEST_PERMINISTER_CLIENT_ID`/`_SECRET`/`_URL`) and `testing/fake-perminister.ts`.
  - `CLAUDE.md`: the five environment variables, the `auth generate` command and the pinned versions.
- **Proof**:
  - `pnpm --filter @sky-brain/server exec vitest run src/auth src/config src/server --reporter=verbose`:
    4 files, 27 tests passed; every `prints` line of the check block is in the output (the five
    `discovery:` lines, the three `perminister:` lines, and the `refuses ...` lines, plus
    "refuses production without BETTER_AUTH_SECRET" and "reads the auth settings").
  - `pnpm --filter @sky-brain/server exec drizzle-kit generate`: `No schema changes, nothing to migrate`.
  - `pnpm --filter @sky-brain/server build:vercel`: `dist/vercel.mjs  2.9mb`, `Done`. Extra check:
    importing the bundle with `NODE_ENV=production` and placeholder auth settings loaded the app;
    without them it refused with `PUBLIC_URL must be set when NODE_ENV is production`.
  - `node tools/dev-smoke.mjs`: `healthz 200`, exit 0 (no auth settings set).
  - `pnpm lint && pnpm typecheck && pnpm test`: exit 0 (shared 15 tests, server 258 tests).
  - `pnpm install --frozen-lockfile`: no peer dependency warning.
- **Decisions**:
  - `@better-auth/oauth-provider` 1.7.15 is a direct, exact dependency. Without it pnpm resolved
    `@better-auth/mcp`'s `^1.7.15` to 1.7.18, whose peers (`better-auth ^1.7.18`,
    `better-call 1.4.5`, `@better-auth/core ^1.7.18`) warned. With the pin, `better-call` 1.4.4 and
    `@better-auth/core` 1.7.15 resolve with no warning, so they are not direct dependencies. It
    also gives `auth.ts` and the harness the `ClientMetadataResourceFetch` type.
  - `cli-config.ts` calls `createAuth` itself (with `drizzle.mock({ schema })` and placeholder
    values) instead of repeating the `betterAuth({...})` options, so the CLI always sees exactly
    the app's plugins.
  - The three `/.well-known/*` routes are mounted on the same `toNodeHandler(auth)`: the
    oauth-provider and `mcp()` plugins answer those absolute paths in Better Auth's own handler.
  - `readConfig` checks an https origin as `new URL(v).protocol === "https:" && url.origin === v`,
    which refuses a path, query, trailing slash or credentials in one rule; the
    `BETTER_AUTH_SECRET` error never echoes the value.
  - `getToken` also throws (naming status 200) when a 200 answer lacks `account.subjectId` or
    `sessionToken`, and on a non-200 cancels the body unread. `getUserInfo`'s `name` falls back to
    the email, then the `subjectId` (Better Auth needs a name; an email-less account is refused
    by Better Auth anyway).
  - `start` closes the database if building the app throws.
  - The harness listens on a bare `http.Server` first, then builds the app with that URL and
    attaches it as the request listener. `TestResponse` is reused from `harness.ts`; the 8-line
    `toTestResponse` is copied because `harness.ts` is outside Touches.
- **Shortcuts taken**: none.
- **For later tickets**:
  - 03/04: fill `src/auth/pages/sign-in.ts` and `consent.ts`; `routes.ts` already serves them with
    the CSP and `no-store` and answers 404 while a string is empty. Add `mayEnter` and the hooks to
    the `betterAuth({...})` in `auth.ts`; `cli-config.ts` follows automatically.
  - The fake's `sessionToken` is `perminister-session-<subjectId>-<random>`; the discovery test
    relies on that prefix to prove the stored `access_token` is encrypted.
  - `plans/login-mcp/acceptance/helpers.ts` still calls `setGoogleUser` and passes
    `bootstrapOwnerEmail`/`allowedEmails`; the harness follows spec.md (`setPerministerAccount`).
    Those acceptance files are stale against the repaired spec; a human or the tester must
    update them (not this ticket).
  - `CLAUDE.md` line 6 and `docs/PLAN.md` still say "People sign in with Google"; not in this
    ticket's Touches.
