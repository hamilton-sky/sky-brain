# Follow-ups: login-mcp

What the run left for later: minor findings of passing reviews, the findings a level 2 ticket passed with after 2 review rounds, and Done when checks this host could not pass. Each is a candidate for a cleanup ticket.

## 01-settle-render-plan (left for later)

- 1. minor plans/login-mcp/map.md: the new "- 01 — ..." line is one ~190-column line while every neighbouring Decisions line is wrapped at about 100 columns (prettier ignores plans/, so lint does not catch it) - wrap it to match. (pair review)

## 02-better-auth-foundation (left for later)

- 1. minor apps/server/src/auth/from-config.ts: Outside production with DATABASE_URL set and no BETTER_AUTH_SECRET, each process still gets its own random secret. Against a shared or persistent Postgres, the first process writes the jwt() key encrypted with a secret that is then lost. From the next restart on, every JWT signing fails ("Failed to decrypt private key") until someone empties `jwks` by hand. CLAUDE.md documents this ("set it yourself there"), but it fails silently and leaves the database broken. Change: when databaseUrl is set and betterAuthSecret is not, throw at start ("set BETTER_AUTH_SECRET when DATABASE_URL is set"), the same way production does. Keep the per-process secret for memory:// only. (pair review)
- 2. minor plans/login-mcp/spec.md (Settings, line 365): the row still says "a random value per process (sessions do not survive a restart)". The spec's createAuth option list also lacks `accountLinking: { enabled: false }`. map.md says a human must edit these. Until that edit, the next builder works from a spec that contradicts the code. Change: have the plan owner update both lines before ticket 03, which extends the same createAuth call. (pair review)
- 3. minor plans/login-mcp/tasks/03-*.md: with linking off, a second Perminister subject that has an existing user's email now lands on the errorCallbackURL with `?error=account_not_linked`. Ticket 03's sign-in page handles only `no_access`, `email_not_found` and `invalid_code`, so this person would see no message or a generic one. Change: add `account_not_linked` to the error list that ticket 03's page shows (as "no access" or its own message), via map.md or a plan edit. (pair review)

## 03-google-sign-in-access (left for later)

- 1. minor apps/server/src/auth/pages/sign-in.ts: the sign-in script sends all of location.search as oauth_query on any /sign-in visit, not only when an OAuth authorize flow sent the person there. So a crafted /sign-in?... link sends any query the attacker picks to Better Auth's oauth-provider resume logic. It is harmless today, because that logic is ticket 04's and it checks the signature. - In ticket 04, check that a forged or unsigned oauth_query is refused (or only forward it when it carries the signed parameters), and add a test. (pair review)
- 2. minor plans/login-mcp/acceptance/helpers.ts (not in this diff): the acceptance suite still calls server.setGoogleUser. The Perminister harness has no such method, so all 50 acceptance tests fail before they reach any ticket's code, and followups.md does not record this. - Add a follow-up to move the helpers to setPerministerAccount/approve before ticket 07. (pair review)

## 04-consent-and-oauth-flow (left for later)

- 1. minor apps/server/src/auth/oauth-flow.test.ts: the loopback test proves only the allowed case. Better Auth widens the match for loopback redirects (stripLoopbackRedirectPort), and the ticket's purpose is to make a Better Auth upgrade that breaks this fail `pnpm test`. Nothing pins the refused side: a look-alike host (http://localhost.evil.test:53682/callback), a loopback redirect with an unlisted path (http://localhost:53682/other), or https://localhost for an http registration - add one refused loopback case to "a redirect URI the metadata does not list is refused". (pair review)
- 2. minor apps/server/src/auth/pages/consent.ts: when /api/auth/get-session answers 200 with a null body (no session), the page leaves the placeholder "you" and shows no status. The catch path only covers a non-2xx answer. Treat a missing session.user like the failure: set the status line and disable Allow. (pair review)
- 3. minor apps/server/src/auth/pages/consent.ts: only the `brain:*` scopes are shown, so a request that adds offline_access (refresh tokens that outlive the visit) or profile/email reads "Access: read, write", or "your sign-in only" when there are no brain scopes. That matches the spec mock-up, so it is not a defect here. Consider saying "stays signed in" when offline_access is present. (pair review)
- 4. minor apps/server/src/auth/oauth-flow.test.ts: 397 lines, at the 400-line limit (CLAUDE.md). Ticket 05 or a later ticket that adds a case here must split it first. One option is to move the flow helpers (authorizeAndSignIn, getCode, token, codeGrant) into src/testing/. (pair review)

## 05-mcp-endpoint-whoami (left for later)

- 1. minor apps/server/src/mcp/route.ts: `createMcpHandler(mcpServerFactory(o.db))` takes the SDK's default body limit of 4 MiB and up to 100 messages per JSON-RPC batch. So one authenticated POST can run up to 200 `whoami` database queries, while `/api/v1` caps bodies at 64kb. Fix: pass `maxRequestBodySize` (64kb, matching `/api/v1`) when the handler is built. (pair review)
- 2. minor apps/server/src/mcp/whoami.ts: when the user row is missing, the memberships query still runs before the code throws "No such user." Fix: check `row` straight after the first query. (pair review)
- 3. minor apps/server/src/mcp/actor.ts: `client.hostname.toLowerCase()` repeats work, because the URL parser already lower-cases the hostname. Fix: drop the call, or keep it and say in a comment that it is belt-and-braces. (pair review)

## 06-render-env-and-connect-doc (left for later)

- 1. minor /home/user/sky-brain/docs/CONNECT.md: Section 2 says to set the variables in "Production scope", then says "Preview deployments share the settings". A Production-only variable is not passed to previews. On Vercel, previews run with NODE_ENV=production, so a preview missing these variables refuses to start, and one that has them runs with the production secret and database. Both sentences come word for word from the ticket. - Say which scopes each variable goes in (Production only, or Production and Preview), and change the preview sentence to match. (pair review)
- 2. minor /home/user/sky-brain/docs/CONNECT.md: The local-dev step runs `set -a; . ./.env; set +a`, which runs the file as shell. An unquoted secret containing `$`, `;`, `&`, a space or backticks is changed or run as a command when the file is sourced. - Tell the reader to wrap each value in single quotes, e.g. `PERMINISTER_CLIENT_SECRET='...'`. (pair review)

## 08-perminister-app-client-names (left for later)

- 1. minor /home/user/sky-brain/apps/server/src/config.ts: the id and the secret fall back separately. If PERMINISTER_APP_CLIENT_ID and the old PERMINISTER_CLIENT_SECRET are set (or the other way round), the server builds an id/secret pair from two different clients and still passes checkProductionAuth. The fault only shows up later as a failed token exchange with Perminister, not at startup. This is not a security hole, because whoever sets the env vars already controls the deployment. Fix: take both values from the new names or both from the old names. If they are mixed, fail at startup, or add a test that records the current behaviour. (pair review)
- 2. minor /home/user/sky-brain/apps/server/src/config.ts: a value of only spaces (e.g. PERMINISTER_APP_CLIENT_ID=" ") counts as set, so it wins over the old name and passes the production check. This is not new: the other settings already worked this way. Fix: trim the values before the || chain if this matters. (pair review)

## 07-prove-the-bar (left for later)

- deferred check, needs network and the deployed service, with PUBLIC_URL set to its address: `curl -sS -o /dev/null -w 'status %{http_code}' -X POST "$PUBLIC_URL/mcp"` (here: exit 3)
- deferred check, needs network and the deployed service, with PUBLIC_URL set to its address: `curl -fsS "$PUBLIC_URL/.well-known/oauth-protected-resource/mcp"` (here: exit 3)
