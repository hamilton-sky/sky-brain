# Add Better Auth with its tables, settings and discovery routes, and the auth test harness

Type: task
Status: open
Blocked by: —
Test first: yes
Level: 3
Touches: apps/server/package.json, pnpm-lock.yaml, apps/server/src/auth/auth.ts, apps/server/src/auth/routes.ts, apps/server/src/auth/cli-config.ts, apps/server/src/auth/discovery.test.ts, apps/server/src/db/auth-schema.ts, apps/server/src/db/schema.ts, apps/server/drizzle/, apps/server/src/config.ts, apps/server/src/config.test.ts, apps/server/src/server.ts, apps/server/src/server.test.ts, apps/server/src/app.ts, apps/server/src/testing/auth-harness.ts, CLAUDE.md

The base every other ticket builds on: Better Auth inside the app, on the existing database, with
the OAuth server metadata answering at the exact paths claude.ai reads. Follow map.md's spike
lines; they were run against these exact versions.

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

**Settings** (`config.ts`): `Config` gains `publicUrl`, `betterAuthSecret`, `googleClientId`,
`googleClientSecret` and `bootstrapOwnerEmail` (all `string | undefined`), read from `PUBLIC_URL`,
`BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BOOTSTRAP_OWNER_EMAIL` (empty
means unset), and `allowedEmails: string[]` from `ALLOWED_EMAILS` (comma separated; each entry
trimmed and lower-cased, empty entries dropped; unset gives `[]`). `bootstrapOwnerEmail` is
trimmed and lower-cased too. With `NODE_ENV=production`, `readConfig` throws an error naming the first setting
that is missing, a `PUBLIC_URL` that is not `https://` with no path, query or trailing slash, or a
`BETTER_AUTH_SECRET` under 32 characters. Update the existing production case in `config.test.ts`
to pass the new settings.

**The auth instance** (`auth/auth.ts`, new): `createAuth({ db, publicUrl, secret, google?,
bootstrapOwnerEmail?, allowedEmails?, fetchClientMetadataResource })` returns `betterAuth({ baseURL: publicUrl, basePath: "/api/auth",
secret, database: drizzleAdapter(db, { provider: "pg", schema }), socialProviders: { google }
(only when given), plugins: [jwt(), mcp({ loginPage: "/sign-in", consentPage: "/consent",
resource: publicUrl + "/mcp", scopes: ["openid", "profile", "email", "offline_access",
"brain:read", "brain:write"] }), cimd({ fetchClientMetadataResource, metadataProfile:
"mcp-2026-07-28" })] })`. No `oauthProvider()` next to `mcp()`; no dynamic registration options.
Export its type as `Auth`. `bootstrapOwnerEmail` and `allowedEmails` are part of the options type
now so the harness and `server.ts` pass them from this ticket on; ticket 03 is the first to read
them (do not destructure them here, so lint has no unused variable).

**Routes** (`auth/routes.ts`, new): `mountAuth(app, auth)` mounts `toNodeHandler(auth)` on
`/api/auth/*splat`, `GET /.well-known/oauth-protected-resource`,
`GET /.well-known/oauth-protected-resource/mcp` and
`GET /.well-known/oauth-authorization-server/api/auth`; and serves `GET /sign-in` and
`GET /consent` from `src/auth/pages/sign-in.html` and `consent.html` (new in tickets 03 and 04), and the folder's other files
under `/auth-pages/`, each with `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`
and `Cache-Control: no-store` (the pages arrive in tickets 03 and 04; a missing file answers 404).
`AppOptions` gains an optional `auth: { instance: Auth; publicUrl: string }` (spec.md Decisions:
the URL travels with the instance) and, when given, `createApp` calls `mountAuth(app,
options.auth.instance)` right after `/healthz`,
before `/api/v1`, the `/api` 404, `express.static` and `/{*splat}`.

**Start** (`server.ts`): build the auth instance from the config and pass `auth: { instance,
publicUrl }` and `bootstrapOwnerEmail` and `allowedEmails` on; when `publicUrl` is unset, use
`http://127.0.0.1:<config.port>` (spec.md Decisions); when `betterAuthSecret` is unset outside
production, use a random 32-byte value per process. Production passes `fetchClientMetadataResource` from
`@better-auth/cimd/node`. Update `server.test.ts` for the new `Config` fields.

**Harness** (`testing/auth-harness.ts`, new): `startAuthTestServer` exactly as spec.md Interfaces →
How a test reaches the server says: it listens on `127.0.0.1:0`, uses that URL as `publicUrl`,
injects a fake `fetchClientMetadataResource` that serves `cimdDocuments` (404 for any other URL),
wraps `globalThis.fetch` so `https://oauth2.googleapis.com/token` answers with an `id_token` built
from `setGoogleUser`'s profile (every other URL passes through; `close` restores it), and
implements `browser()` and `signJwt` (through `auth.api.signJWT({ body: { payload } })`, which
returns `{ token }`; map.md). It passes `auth: { instance, publicUrl: url }` to `createApp`, and
`bootstrapOwnerEmail` and `allowedEmails` (spec.md Interfaces) to `createAuth`. Who may sign in,
personal workspaces and invites are ticket 03's.

**Docs.** No decision here: login-mcp owns only D16 to D18, and this setup (versions, issuer,
resource, CIMD on, DCR off) is recorded in D18, the T0 result (ticket 07). CLAUDE.md's Commands section lists the six new environment variables and the schema command,
and records the pinned versions (the CLI flags are in map.md).

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
- `readConfig`: "refuses production without PUBLIC_URL", "refuses a PUBLIC_URL that is not https
  in production", "refuses production without BETTER_AUTH_SECRET", "refuses production without the
  Google client", and the allowed case "reads the auth settings" (including `ALLOWED_EMAILS`
` Ann@X.com, ,bob@y.com ` read as `["ann@x.com", "bob@y.com"]`).

## Not in this ticket

- Who may sign in (the allowlist, the bootstrap owner, invites, "No access"), personal
  workspaces and the session resolver: ticket 03.
- The sign-in and consent pages themselves: tickets 03 and 04.
- `/mcp` and the bearer check: ticket 05.
- `render.yaml` env vars and the new `docs/CONNECT.md`: ticket 06.

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/auth src/config src/server --reporter=verbose`
  passes and its output contains the `prints` lines below.
- `pnpm --filter @sky-brain/server exec drizzle-kit generate` prints `No schema changes` (schema.ts
  and the migrations agree).
- `node tools/dev-smoke.mjs` prints `healthz 200` (`pnpm dev` still starts with no auth settings).
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/auth src/config src/server --reporter=verbose
prints discovery: protected resource metadata names the /mcp resource and the issuer
prints discovery: authorization server metadata advertises S256, none and CIMD
prints discovery: dynamic client registration is off
prints discovery: auth routes are not shadowed by the /api 404 or the web catch-all
prints refuses production without PUBLIC_URL
prints refuses a PUBLIC_URL that is not https in production
$ pnpm --filter @sky-brain/server exec drizzle-kit generate
prints No schema changes
$ node tools/dev-smoke.mjs
prints healthz 200
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Interfaces, § Design, § Migration and compatibility.
- map.md § Decisions so far (the spike lines and the real exports).
- `apps/server/src/app.ts` (route order), `apps/server/src/db/client.ts`, `apps/server/src/testing/harness.ts`
  (reuse `TestResponse`), `plans/brain-core/learnings.md` (drizzle-kit and prettier notes); read-only:
  `docs/layer-1/LOGIN-MCP-PLAN.md`.

## Answer
