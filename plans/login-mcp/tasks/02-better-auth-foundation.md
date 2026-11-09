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

### Round 1 fixes

Work on the findings started at `0a0707915ca6771622b5714ada7167af8302aada`; the two new tests were
committed alone first (`1ae44f9 test(login-mcp): 02 failing test`) and failed for the right
reasons (a session cookie for the second subject; `Failed to decrypt private key` on the restart).

- **Built**: `auth/auth.ts` (`account.accountLinking: { enabled: false }`; `cli-config.ts` follows
  because it calls `createAuth`), `auth/from-config.ts` (dev secret kept with the PGlite folder),
  `testing/auth-harness.ts` (cookie removal on a past `Expires` or `Max-Age<=0`),
  `auth/discovery.test.ts` (new test), `auth/from-config.test.ts` (new), `CLAUDE.md`
  (`BETTER_AUTH_SECRET` line), `learnings.md` (one line).

Extra file: apps/server/src/auth/from-config.test.ts - round 1 finding 2 asks for a test that two `authFromConfig` instances over one persistent dev database both sign a JWT; it is the unit test of `from-config.ts` (in Touches), needs its own module graph per start (`vi.resetModules`), and fits no listed test file.

- **Proof** (all run after the last edit):
  - focused vitest run: 5 files, 29 tests passed, every `prints` line present, plus
    "perminister: a second subject with the same email does not enter the first person's account"
    and "keeps signing JWTs after a dev restart on the same database".
  - `drizzle-kit generate`: `No schema changes, nothing to migrate` (linking is not a schema change).
  - `build:vercel`: `dist/vercel.mjs  2.9mb`.
  - `node tools/dev-smoke.mjs`: `healthz 200`, exit 0.
  - `pnpm lint && pnpm typecheck && pnpm test`: exit 0 (shared 15, server 260 tests).
- **Review fixes**:
  1. Account linking: `accountLinking: { enabled: false }` rather than only
     `disableImplicitLinking`, because `enabled: false` also refuses `/api/auth/link-social`
     (`better-auth/dist/api/routes/account.mjs` line 207) as well as the implicit link in the
     callback (`oauth2/link-account.mjs` line 141). Test: subject B with A's email gets no session
     cookie, `get-session` has no user, A's user still has only A's account row; A signing in
     again gets A's user id. Better Auth answers B with `error=account_not_linked` to the error
     URL. The option is not in spec.md's `createAuth` option list; I may not edit the spec, so a
     human should add `accountLinking: { enabled: false }` to spec.md Interfaces and ticket 03's
     copy of the call.
  2. Dev secret: with no `BETTER_AUTH_SECRET` outside production and a persistent PGlite folder,
     `authFromConfig` creates `<PGLITE_DATA_DIR>/sky-brain-auth-secret` once (32 random bytes,
     base64url, `wx`, mode 0600) and reads it on every start, so it lives and dies with the dev
     database and sits in the git-ignored `.pglite/`; under 32 characters it refuses naming the
     file. `memory://` (tests, dev-smoke) and `DATABASE_URL` outside production keep a random
     value per process. Test: two fresh module graphs (`vi.resetModules`) open the same PGlite
     folder in turn and both sign a JWT. A dev `.pglite` made before this fix still holds a `jwks`
     row under the old random secret: delete the folder once. spec.md Interfaces → Settings
     ("a random value per process") needs the same correction; I may not edit it.
  3. `auth-schema.ts` (401 lines) is CLI output that must not be hand-edited; recorded in
     learnings.md that generated files are exempt from the 400-line rule.
  4. `GET /api/auth/token`: left on (map.md already says ticket 05 must refuse it on `/mcp` and
     test it). Ticket 05: the bearer check must require `aud` to contain exactly
     `<publicUrl>/mcp` and `iss` `<publicUrl>/api/auth`; a session JWT from `/api/auth/token`
     has `aud` `<publicUrl>` and must get 401.
  5. Harness cookie jar: a `Set-Cookie` with `Max-Age` <= 0 or an `Expires` in the past now
     removes the cookie, as does an empty value.
  - Not this ticket (spec reviewer's note): the acceptance suite is still Google-era
    (`setGoogleUser`) and expects 404 for `POST /api/auth/oauth2/register` where Better Auth
    answers 403; the ticket's bar is "not 2xx". Needs the tester or a human.
- **Shortcuts taken**: none.

### Round 2 fixes

Work started at `cf25a4b`. No code changed.

- **Review fixes**:
  1. Footprint check: `apps/server/src/auth/from-config.test.ts` is still the only path outside
     Touches (checked with `git diff --name-only 7ac098c..HEAD`). Round 1 did name it, but as a
     `- Extra file:` bullet, and the conductor reads only a line that starts with `Extra file:`
     (the `EXTRA` regex in `buildchecks.py` is anchored at the start of the line), so it found
     nothing. That line now stands alone at the start of a line in Round 1 fixes, and the same regex
     run over this Answer returns that path. The test stays where it is: it is round 1's proof
     for finding 2, it re-imports `from-config.ts` in fresh module graphs (`vi.resetModules`),
     and moving it into `discovery.test.ts` would put that reset into a file that shares
     one server across its tests.
- **Proof** (run after the edit): focused vitest run 5 files, 29 tests passed, every `prints`
  line present; `drizzle-kit generate` `No schema changes, nothing to migrate`; `build:vercel`
  `dist/vercel.mjs  2.9mb`; `node tools/dev-smoke.mjs` `healthz 200`, exit 0;
  `pnpm lint && pnpm typecheck && pnpm test` exit 0 (shared 15, server 260 tests).
- **Shortcuts taken**: none.

## Review findings (round 1, pair review)

Range reviewed: 7ac098c6f9936abbb4fb12068fadfdc37e3303b5..cd812c5 (END = HEAD; no later commits left out). Ticket read at the base commit; the Answer was not read. I re-ran every Done when command myself and all pass: the focused vitest run (27 tests, every `prints` line present), drizzle-kit generate ("No schema changes"), build:vercel (dist/vercel.mjs), tools/dev-smoke.mjs (healthz 200), and `pnpm lint && pnpm typecheck && pnpm test` (exit 0). build:vercel rewrote apps/server/dist/vercel.mjs, which git ignores; I left it there.

Inputs I probed as a hostile caller (level 3): the query string on GET /auth/perminister/callback (fixed relative target, nothing to inject); POST /api/auth/sign-in/social (callbackURL is checked against baseURL by Better Auth; the authorize URL carries no secret); the Perminister token answer (getToken accepts only a 200 with account.subjectId and sessionToken, errors name only the status, timeout 10 s); the CIMD client_id URL (the @better-auth/cimd/node fetcher allows only https and public-routable DNS answers, pins the address and does not follow redirects); POST /api/auth/oauth2/register (refused); PUBLIC_URL, PERMINISTER_BASE_URL and BETTER_AUTH_SECRET in production (refused unless they are an https origin with no path, or 32+ characters; the error message never echoes the value); the page routes (an empty module answers 404 with the CSP and no-store headers). Two ways through or breakages remain:

QUALITY
1. major apps/server/src/auth/auth.ts: A second Perminister identity can enter an existing person's account. getUserInfo always returns emailVerified: true, and createAuth leaves Better Auth's implicit account linking on (account.accountLinking defaults to enabled, requireLocalEmailVerified is met because every user is created with emailVerified true). In better-auth 1.7.15 (oauth2/link-account.mjs, handleOAuthUserInfo), a callback whose (perminister, subjectId) has no account row but whose email matches an existing user gets a new account row linked to that user, and is signed in as that user. So the "keyed by subjectId" rule in spec.md holds only for the first subject: if Perminister ever gives a second subject the same email (the first person changes email and someone else is invited at the old one, or two Perminister accounts share an email), the second person gets the first person's user, sessions and, later, workspaces and MCP tokens. The same path lets a signed-in user call /api/auth/link-social to attach another Perminister subject with a matching email. Change: set `account: { encryptOAuthTokens: true, accountLinking: { disableImplicitLinking: true } }` (or `enabled: false`) in createAuth and in cli-config.ts (cli-config already calls createAuth), and add a discovery or sign-in test: subject A and subject B with the same email, B's callback creates no session for A's user (the refused case), A signing in again still gets A (the allowed case). This changes the exact option list that ticket 02 and spec.md set, so the plan needs one line for it (ticket 03 also adds to this call).
2. major apps/server/src/auth/from-config.ts: In `pnpm dev` the random BETTER_AUTH_SECRET for each process (secretOf) breaks the server after the first restart, not only the sessions. The jwt() plugin stores its private key in the `jwks` table, encrypted with the secret. Dev keeps its database across restarts (PGLITE_DATA_DIR defaults to apps/server/.pglite), so after a restart better-auth's jwt/sign.mjs throws "Failed to decrypt private key", and every JWT it signs (the MCP access tokens from oauth2/token, id_tokens, /api/auth/token) fails until someone empties `jwks` by hand. The encrypted Perminister tokens in `account` can no longer be read either. Tickets 05 and 07 (local MCP sign-in, the T0 run against `pnpm dev`) will hit this. Change: when no secret is set outside production, use one that lasts as long as the dev database does. For example, generate it once and store it beside the PGlite data dir (a file under .pglite), or use only a random secret for each process when PGLITE_DATA_DIR is memory://. Add a test that two authFromConfig instances built over the same persistent dev database can both sign a JWT. Correct the CLAUDE.md BETTER_AUTH_SECRET line to match. spec.md Settings says "a random value per process", so that row needs the same correction.
3. minor apps/server/src/db/auth-schema.ts: 401 lines, over the 400-line rule in CLAUDE.md. It is CLI output and must not be hand-edited, so record that generated files are exempt (in learnings.md or CLAUDE.md) instead of splitting it.
4. minor apps/server/src/auth/auth.ts: jwt() also exposes GET /api/auth/token, which turns a session cookie into a JWT signed by the same JWKS key that will sign MCP access tokens (aud = the base URL, not <url>/mcp). Ticket 05's bearer check must therefore require aud exactly `<publicUrl>/mcp` and the issuer, or a cookie-derived JWT will pass as an MCP token. Note this in the plan for ticket 05, or turn off the /token endpoint if nothing needs it.
5. minor apps/server/src/testing/auth-harness.ts: the browser cookie jar drops a cookie only on an empty value or Max-Age=0, not on an Expires date in the past. That is enough for Better Auth today, but sign-out tests in tickets 03 and 04 will silently keep cookies if that changes. Treat a past Expires as removal too.

Not judged here (the other reviewer covers Done when and scope): the acceptance suite fails in helpers.ts with `server.setGoogleUser is not a function`. The acceptance helpers still call a Google-era harness method that this ticket (Perminister only) does not provide.

REVIEW: FAIL
Range reviewed: 7ac098c6f9936abbb4fb12068fadfdc37e3303b5..cd812c5 (END = HEAD; the ticket's last commit is HEAD, so no later commits are left out). Two commits: 46e5892 (failing tests) and cd812c5 (the work). I read the ticket as of 7ac098c only; the Answer did not reach me.

SPEC
- vitest run src/auth src/config src/server passes with the prints lines: MET (conductor)
- drizzle-kit generate prints `No schema changes`: MET (conductor)
- build:vercel prints `vercel.mjs`: MET (conductor)
- node tools/dev-smoke.mjs prints `healthz 200`: MET (conductor)
- pnpm lint && pnpm typecheck && pnpm test exits 0: MET (conductor)
- acceptance tests (conductor note, re-run by me: `pnpm exec vitest run --root plans/login-mcp/acceptance`, 53 failed / 16 passed): the parts this ticket delivers pass. That covers the three discovery-document tests (connector.test.ts), the readConfig PUBLIC_URL and BETTER_AUTH_SECRET cases, the http PUBLIC_URL outside production case, and /api/v1 401 without a session. The other failures fall into two groups. Some belong to tickets 03-05: sign-in, No access, pages (still stub pages that answer 404), /mcp and whoami. The rest are stale against the repaired plan (aa14620): the suite was written in 12caedc for Google sign-in and calls server.setGoogleUser and GOOGLE_CLIENT_ID/SECRET, ALLOWED_EMAILS and BOOTSTRAP_OWNER_EMAIL, which this ticket explicitly forbids. One failure is close to this ticket: hostile.test.ts "POST /api/auth/oauth2/register does not exist" expects 404 and gets 403. The 403 comes from @better-auth/oauth-provider's unconditional `if (!opts.allowDynamicClientRegistration) throw FORBIDDEN`, which runs before any session check, so DCR really is off for everyone. The ticket's own bar is "not 2xx", and that bar is met. The spec line ("does not exist") and the acceptance test (404) are stricter than the ticket. That is a plan inconsistency for whoever owns the Hostile story (ticket 04 references it) or the acceptance suite, not a miss in this ticket. Follow-up: settle 404 vs 403 and regenerate the acceptance suite for Perminister.
- scope: OK. Every changed file is in Touches or under apps/server/drizzle/. plans/login-mcp/map.md and learnings.md each get one line, which map.md's "How to work this" asks for. Note: package.json also adds `@better-auth/oauth-provider` 1.7.15 as a direct dependency. The ticket does not name it, but it is pinned to match the others and silences a peer mismatch (1.7.18 pulled in transitively). It is used only as a type import, and no oauthProvider() plugin is added.
- test first: OK. 46e5892 adds discovery.test.ts, perminister.test.ts and the new config/server cases before any production code. They import modules that did not exist yet (auth-harness, perminister, the new Config fields), so they fail without the change, and the conductor saw them fail. All ticket-named test names are present.

REVIEW: PASS

## Review findings (round 2, footprint check)

the build changed paths outside the ticket's `Touches:` line (apps/server/package.json pnpm-lock.yaml apps/server/src/auth/auth.ts apps/server/src/auth/perminister.ts (new) apps/server/src/auth/perminister.test.ts (new) apps/server/src/auth/from-config.ts (new) apps/server/src/auth/routes.ts apps/server/src/auth/cli-config.ts apps/server/src/auth/discovery.test.ts apps/server/src/db/auth-schema.ts apps/server/src/db/schema.ts apps/server/drizzle/ apps/server/src/config.ts apps/server/src/config.test.ts apps/server/src/server.ts apps/server/src/server.test.ts apps/server/src/vercel.ts apps/server/src/app.ts apps/server/src/testing/auth-harness.ts (new) apps/server/src/testing/fake-perminister.ts (new) apps/server/src/auth/pages/sign-in.ts (new) apps/server/src/auth/pages/consent.ts (new) CLAUDE.md): apps/server/src/auth/from-config.test.ts. tickets run side by side because their Touches do not overlap, so change only what Touches names. if the ticket cannot be done inside it, say so in the Answer and stop: the plan has to change, not the footprint. one file the ticket truly needs (a test that pins the old behaviour, a generator) may be named in the Answer as `Extra file: <path> - <why>`, when it is the only one
