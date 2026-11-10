# Learnings: login-mcp

Things a fresh worker would otherwise waste time rediscovering: a command that works, a
trap, a quirk of the environment. Append one or two lines, newest last, tagged with your
ticket number. Never edit or delete another line. Keep it short; a human prunes it.

- (02) `pnpm add @better-auth/mcp@1.7.15` pulls `@better-auth/oauth-provider` 1.7.18 with peer warnings; the exact direct pin of `@better-auth/oauth-provider` 1.7.15 fixes it. The `auth generate` CLI prints a "Drizzle schema mismatch" error while generating; it still writes the file.
- (02) Generated files (`apps/server/src/db/auth-schema.ts` from `auth generate`, `drizzle/*`) are exempt from the 400-line rule: never split or hand-edit them. A dev `.pglite` from before the round-1 fix holds `jwks` encrypted with an old random secret ("Failed to decrypt private key"): delete the folder once.
- (03) Every sign-in through `startAuthTestServer` now also makes a workspace and an `owner` row (`onSignIn`), so count `workspaces`/`members` per user, not across the database. Better Auth logs "State mismatch" and "Failed to validate authorization code" as ERROR in the refused-sign-in tests; that is expected output, not a failure.
- (03) PGlite runs one transaction at a time, so a race between two connections cannot be shown in Vitest; `/usr/lib/postgresql/16/bin` has a real Postgres 16 (initdb/pg_ctl as user `postgres`) for a hand check.
- (04) The Perminister callback answers 302 `Location: /` plus a body `{redirect: true, url: "/consent?..."}`; the harness `next` takes `Location`, so follow `body.url` first. Consent is remembered per person and client: add `prompt=consent` to authorize to see the page again.
- (04) Vitest 5 hides `console.log` of passing tests; run with `--silent=false` to see it.
- (05) A shared test helper outside `*.test.ts` and `src/testing/` gets the full type-checked lint (no `any`); cast `res.body` to a small interface. In an MCP tool callback the auth info is `ctx.http.authInfo`; in the `createMcpHandler` factory it is `ctx.authInfo`.
