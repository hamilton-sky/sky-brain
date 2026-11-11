# Make the acceptance tests pass, round 1

Type: task
Status: open
Blocked by: —
Test first: no
Level: 2
Check: none the conductor runs the acceptance tests again once every ticket is resolved

Every ticket is resolved, but the acceptance tests fail. The tester wrote them in `plans/login-mcp/acceptance/` from spec.md before the build, so they check what the product owner asked for, not how it was built. Fix the code so they pass. You may run them with `pnpm exec vitest run --root plans/login-mcp/acceptance`.

If you are sure a test asks for something spec.md does not say, do not work around it, and do not change the test: the floor guard fails any change under `plans/login-mcp/acceptance/`. Add a `## Ask: po` section to this ticket that names the test, what it expects and the spec.md line it disagrees with, and stop. The product owner rules on it. A test it rules wrong is left failing here and goes back to the tester once this ticket is resolved.

## Not in this ticket

- Any file under `plans/login-mcp/acceptance/`.

## Done when

- `pnpm exec vitest run --root plans/login-mcp/acceptance` passes, apart from tests the product owner ruled wrong in this ticket.
- commands.md's Test command passes.

## The failing run

        200|   oauthQuery?: string,
        201| ): Promise<Res> {
        202|   server.setGoogleUser(googleUser(user));
           |          ^
        203|   const start = await b.request(
        204|     "/api/auth/sign-in/social",
     ❯ signIn helpers.ts:227:26
     ❯ sign-in.test.ts:192:11
    
    ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[40/44]⎯
    
     FAIL  sign-in.test.ts > invites are accepted at sign-in > whoami lists the own workspace and the invited one, with the invite's role, and no other
    TypeError: server.setGoogleUser is not a function
     ❯ googleSignIn helpers.ts:202:10
        200|   oauthQuery?: string,
        201| ): Promise<Res> {
        202|   server.setGoogleUser(googleUser(user));
           |          ^
        203|   const start = await b.request(
        204|     "/api/auth/sign-in/social",
     ❯ getCode helpers.ts:291:20
     ❯ connect helpers.ts:337:13
     ❯ sign-in.test.ts:205:50
    
    ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[41/44]⎯
    
     FAIL  sign-in.test.ts > the session cookie on /api/v1 > with the session cookie /api/v1/<unknown path> answers 404
    TypeError: server.setGoogleUser is not a function
     ❯ googleSignIn helpers.ts:202:10
        200|   oauthQuery?: string,
        201| ): Promise<Res> {
        202|   server.setGoogleUser(googleUser(user));
           |          ^
        203|   const start = await b.request(
        204|     "/api/auth/sign-in/social",
     ❯ signIn helpers.ts:227:26
     ❯ sign-in.test.ts:221:31
    
    ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[42/44]⎯
    
     FAIL  sign-in.test.ts > the session cookie on /api/v1 > X-Dev-Actor with the dev header off answers 401 dev_actor_disabled even with a valid session
    TypeError: server.setGoogleUser is not a function
     ❯ googleSignIn helpers.ts:202:10
        200|   oauthQuery?: string,
        201| ): Promise<Res> {
        202|   server.setGoogleUser(googleUser(user));
           |          ^
        203|   const start = await b.request(
        204|     "/api/auth/sign-in/social",
     ❯ signIn helpers.ts:227:26
     ❯ sign-in.test.ts:236:41
    
    ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[43/44]⎯
    
    
     Test Files  5 failed | 1 passed (6)
          Tests  44 failed | 25 passed (69)
       Start at  16:14:31
       Duration  6.64s (tests 81%, import 18%, transform 1%)

## Answer

**Built** (partial; the ticket stays open on the Ask below)
- `apps/server/src/auth/routes.ts`: `POST /api/auth/oauth2/register` (any method) now answers 404 `not_found` before Better Auth's handler. The oauth provider answered 403 there, and spec.md line 119 says the route "does not exist" (DCR stays off).
- `apps/server/src/auth/discovery.test.ts`: the DCR test now expects exactly 404 and no `client_id` (it only checked "not 2xx", which the 403 passed).

**Proof**
- `pnpm exec vitest run --root plans/login-mcp/acceptance hostile.test.ts -t register`: 1 passed (was `expected 403 to be 404`).
- `pnpm exec vitest run --root plans/login-mcp/acceptance`: 43 failed | 26 passed (69), was 44 failed | 25 passed. Every remaining failure is one of: `TypeError: server.setGoogleUser is not a function` (35 tests; vitest reports the two loopback tests under one error, so 34 error blocks), `config.test.ts` tests expecting `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `googleClientId` / `ALLOWED_EMAILS` / `BOOTSTRAP_OWNER_EMAIL`, one of which ("reads a complete production configuration") throws on the Perminister settings it does not pass (7), and the sign-in page expecting `<button id="google">` (1). None is a code defect against spec.md; see Ask: po.
- `pnpm test`: exit 0; server 23 files, 301 tests passed; shared 2 files, 15 passed.
- `pnpm lint`: exit 0. `pnpm typecheck`: exit 0.

**Decisions**
- 404 with the same JSON body the `/api` 404 handler uses, mounted in `mountAuth` right before the `/api/auth/*splat` handler, so it cannot be shadowed. No Better Auth option removes the route on 1.7.15 that I found; a route in front of it is the smallest fix.

**Shortcuts taken**: none.

**For later tickets**: the acceptance suite was written from the Google version of the spec (before shammai's 2026-11-09 switch to Perminister). Whoever reruns it needs the tester to rewrite it against spec.md's current Interfaces (`setPerministerAccount`, `approve`, provider `perminister`).

## Ask: po

The acceptance tests in `plans/login-mcp/acceptance/` (43 of 69 still failing) test the earlier Google-and-allowlist design, which spec.md no longer describes. I cannot make them pass without building Google sign-in and the `ALLOWED_EMAILS` / `BOOTSTRAP_OWNER_EMAIL` allowlist that spec.md says were replaced, so I did not work around them and did not change them.

Tests and what they expect, against spec.md:

1. `helpers.ts` `googleSignIn` (used by `signIn`, `getCode`, `connect`, so by 35 tests in `sign-in.test.ts`, `refused.test.ts`, `connector.test.ts`, `hostile.test.ts`): expects `AuthTestServer.setGoogleUser({email, sub, emailVerified, name})`, `POST /api/auth/sign-in/social` with `provider: "google"` returning a URL on `https://accounts.google.com/`, and a callback at `/api/auth/callback/google`. spec.md lines 455-479 define the harness as `setPerministerAccount(a: PerministerAccount)` plus `approve(authorizeUrl)` and no `setGoogleUser`; lines 509-513 say the flow posts `provider: "perminister"`, gets a URL under `<perministerUrl>/oauth/authorize?` and returns through `/api/auth/callback/perminister`. Lines 13 and 125-126: Perminister replaced Google, "no Google".
2. `sign-in.test.ts` "GET /sign-in answers 200 text/html with a Sign in with Google button": expects `<button id="google">`. spec.md line 54 ("Sign in with Perminister" button) and lines 434-435 (`id="perminister"`).
3. `config.test.ts` "readConfig in production" (throws naming `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, missing and empty: 4 tests) and "reads a complete production configuration" (expects `googleClientId`, `googleClientSecret`, `allowedEmails`, `bootstrapOwnerEmail`, and passes no Perminister settings): spec.md line 211 and the Settings table lines 362-383 require `PERMINISTER_BASE_URL`, `PERMINISTER_CLIENT_ID`, `PERMINISTER_CLIENT_SECRET` and name no Google settings.
4. `config.test.ts` "does not throw without the auth settings and leaves them unset" and "trims and lower-cases ALLOWED_EMAILS and BOOTSTRAP_OWNER_EMAIL": expect `allowedEmails` / `bootstrapOwnerEmail` / Google keys on `Config`. spec.md lines 29-31 and 242-251: `ALLOWED_EMAILS` and `BOOTSTRAP_OWNER_EMAIL` are replaced by Perminister's product access (`mayEnter`); line 376-378 lists the `Config` fields, none of them these.
5. `refused.test.ts` (6 tests) refuse by "not on ALLOWED_EMAILS" and by Google `email_verified: false`. spec.md lines 70-76 and 189-192 refuse by "no organization for product `sky-brain`", "no email" and "access taken away in Perminister".

What I checked: the full failure list (every one of the 43 is a Google or allowlist name, listed above); spec.md's Interfaces, Settings, Decisions and Stories; `apps/server/src/testing/auth-harness.ts`, which implements the spec's interface. The one failure that was a real gap (DCR answering 403, not 404) is fixed above.

Options I see: A, rule these tests wrong and send the suite back to the tester to rewrite against spec.md's Perminister interfaces (my recommendation; the server already follows the spec and has its own Perminister tests for every story); B, add a Google provider, `setGoogleUser` and the allowlist back, which contradicts spec.md and shammai's 2026-11-09 decision.

## Consulted (po)

**Question:**

The acceptance tests in `plans/login-mcp/acceptance/` (43 of 69 still failing) test the earlier Google-and-allowlist design, which spec.md no longer describes. I cannot make them pass without building Google sign-in and the `ALLOWED_EMAILS` / `BOOTSTRAP_OWNER_EMAIL` allowlist that spec.md says were replaced, so I did not work around them and did not change them.

Tests and what they expect, against spec.md:

1. `helpers.ts` `googleSignIn` (used by `signIn`, `getCode`, `connect`, so by 35 tests in `sign-in.test.ts`, `refused.test.ts`, `connector.test.ts`, `hostile.test.ts`): expects `AuthTestServer.setGoogleUser({email, sub, emailVerified, name})`, `POST /api/auth/sign-in/social` with `provider: "google"` returning a URL on `https://accounts.google.com/`, and a callback at `/api/auth/callback/google`. spec.md lines 455-479 define the harness as `setPerministerAccount(a: PerministerAccount)` plus `approve(authorizeUrl)` and no `setGoogleUser`; lines 509-513 say the flow posts `provider: "perminister"`, gets a URL under `<perministerUrl>/oauth/authorize?` and returns through `/api/auth/callback/perminister`. Lines 13 and 125-126: Perminister replaced Google, "no Google".
2. `sign-in.test.ts` "GET /sign-in answers 200 text/html with a Sign in with Google button": expects `<button id="google">`. spec.md line 54 ("Sign in with Perminister" button) and lines 434-435 (`id="perminister"`).
3. `config.test.ts` "readConfig in production" (throws naming `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, missing and empty: 4 tests) and "reads a complete production configuration" (expects `googleClientId`, `googleClientSecret`, `allowedEmails`, `bootstrapOwnerEmail`, and passes no Perminister settings): spec.md line 211 and the Settings table lines 362-383 require `PERMINISTER_BASE_URL`, `PERMINISTER_CLIENT_ID`, `PERMINISTER_CLIENT_SECRET` and name no Google settings.
4. `config.test.ts` "does not throw without the auth settings and leaves them unset" and "trims and lower-cases ALLOWED_EMAILS and BOOTSTRAP_OWNER_EMAIL": expect `allowedEmails` / `bootstrapOwnerEmail` / Google keys on `Config`. spec.md lines 29-31 and 242-251: `ALLOWED_EMAILS` and `BOOTSTRAP_OWNER_EMAIL` are replaced by Perminister's product access (`mayEnter`); line 376-378 lists the `Config` fields, none of them these.
5. `refused.test.ts` (6 tests) refuse by "not on ALLOWED_EMAILS" and by Google `email_verified: false`. spec.md lines 70-76 and 189-192 refuse by "no organization for product `sky-brain`", "no email" and "access taken away in Perminister".

What I checked: the full failure list (every one of the 43 is a Google or allowlist name, listed above); spec.md's Interfaces, Settings, Decisions and Stories; `apps/server/src/testing/auth-harness.ts`, which implements the spec's interface. The one failure that was a real gap (DCR answering 403, not 404) is fixed above.

Options I see: A, rule these tests wrong and send the suite back to the tester to rewrite against spec.md's Perminister interfaces (my recommendation; the server already follows the spec and has its own Perminister tests for every story); B, add a Google provider, `setGoogleUser` and the allowlist back, which contradicts spec.md and shammai's 2026-11-09 decision.

**Answer:**

Option A. All 43 disputed tests are wrong. They test the Google sign-in and `ALLOWED_EMAILS` / `BOOTSTRAP_OWNER_EMAIL` design that spec.md replaced. Do not add Google, `setGoogleUser` or the allowlist.

Builder: leave the server and the acceptance files as they are. Record these 43 as disputed, ruled test-wrong, and finish ticket 09 with the 403-to-404 DCR fix.

Tester: rewrite the suite against spec.md's Perminister interfaces:
- **Harness:** `setPerministerAccount` and `approve(authorizeUrl)` from `apps/server/src/testing/auth-harness.ts`, as in spec.md "How a test reaches the server". Sign-in posts `provider: "perminister"`, gets a URL under `<perministerUrl>/oauth/authorize?`, and returns through `/api/auth/callback/perminister`.
- **Sign-in page:** `GET /sign-in` must hold the button `id="perminister"`.
- **Config:** `readConfig` must require `PERMINISTER_BASE_URL`, `PERMINISTER_CLIENT_ID` and `PERMINISTER_CLIENT_SECRET` in production. `Config` must have `publicUrl`, `betterAuthSecret`, `perministerBaseUrl`, `perministerClientId` and `perministerClientSecret`. No Google or allowlist keys.
- **Refusals:** test the three the spec names: no organization for product `sky-brain` lands on `/sign-in?error=no_access`; no email lands on `/sign-in?error=email_not_found`; access taken away in Perminister gives "No access" at the next sign-in.

The product owner ruled the test wrong: leave it failing and finish the rest. The tester changes it once this ticket is resolved.
