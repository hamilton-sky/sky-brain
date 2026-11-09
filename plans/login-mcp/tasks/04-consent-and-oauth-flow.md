# Add the consent page and prove the CIMD authorize → token flow with PKCE

Type: task
Status: resolved
Blocked by: 02
Test first: yes
Level: 3
Touches: apps/server/src/auth/pages/consent.ts, apps/server/src/auth/oauth-flow.test.ts (new)

LOGIN-MCP-PLAN step 4: the OAuth server half. Better Auth's `mcp()` and `cimd()` (configured in
ticket 02) do the protocol; this ticket adds the one page they need and the tests that pin their
behaviour, so a Better Auth upgrade that breaks claude.ai fails `pnpm test`.

**Consent page** (`auth/pages/consent.ts`, the new stub ticket 02 adds; fill in its `html` and `script`
strings, which ticket 02's new routes already serve at `/consent` and `/auth-pages/consent.js`; spec.md Decisions → Pages ship inside the bundle): as spec.md § UI, with the element ids spec.md Interfaces → The pages names and
`<script src="/auth-pages/consent.js" defer>`. The script reads `client_id`, `redirect_uri` and `scope` from
`location.search`, fetches the client's name from `GET /api/auth/oauth2/public-client?client_id=...`
and the signed-in email from `GET /api/auth/get-session` (both Better Auth endpoints, confirmed
in map.md; no server route is added), and shows the name, the email, the
**host** of `redirect_uri` (`new URL(redirect_uri).host`, from the page's own query: `public-client` returns an empty
`redirect_uris`) and the requested `brain:*` scopes, all
with `textContent` only (the name comes from a stranger's metadata document). Allow posts
`{ accept: true, oauth_query: location.search.slice(1) }` to `/api/auth/oauth2/consent`, Deny posts
`accept: false`; either way it goes to the returned `url`. No inline script.

**Tests** (`auth/oauth-flow.test.ts`, new), through `startAuthTestServer` with two fixture CIMD
documents (`token_endpoint_auth_method: "none"`, `grant_types` `authorization_code` and
`refresh_token`): a claude.ai-style client listing `https://claude.ai/api/mcp/auth_callback`, and a
Claude Code-style client listing `http://localhost/callback` and `http://127.0.0.1/callback`. The
fixture `client_id` URLs are made up; say so in a comment. Sign in through the harness's fake
Perminister with its default account (`productIds` `["sky-brain"]`), so the tests pass whether or
not the access rule (in the ticket beside this one) has landed. Drive the six steps of spec.md Interfaces:
- "oauth: a CIMD client completes authorize to token with PKCE to the claude.ai callback" — the
  code arrives at `https://claude.ai/api/mcp/auth_callback` with the same `state` and
  `iss=<url>/api/auth`; the token response (form-urlencoded request) has a JWT `access_token`
  whose `aud` includes `<url>/mcp` and whose `iss` is `<url>/api/auth`, and a `refresh_token`.
- "oauth: a loopback redirect on any port is accepted" — `http://localhost:53682/callback` and
  `http://127.0.0.1:3118/callback`.
- "oauth: a redirect URI the metadata does not list is refused" — no code is issued.
- "oauth: a token request without the PKCE verifier is refused", and with a wrong verifier.
- "oauth: a reused code answers invalid_grant".
- "oauth: a refresh token rotates and a dead one answers invalid_grant" — `grant_type=refresh_token`
  returns new tokens; a made-up or revoked refresh token answers `invalid_grant` (do not wait out
  `mcp()`'s 30-second `refreshTokenReuseInterval`, map.md).
- "oauth: an unknown CIMD client is refused" — a `client_id` URL the fake fetch answers 404.
- "consent: Deny returns access_denied to the client".
- "pages: the consent page cannot be framed" — `frame-ancestors 'none'` on `GET /consent`; its
  HTML has `id="redirect-host"`, and `GET /auth-pages/consent.js` uses `textContent` and never
  `innerHTML`.

If a test shows Better Auth 1.7.15 does not do what spec.md says (for example the loopback port
rule), stop and write it under Answer → For later tickets; do not patch Better Auth.

## Not in this ticket

- `/mcp` and calling `whoami` with the token: ticket 05.
- Who may sign in: the access rules ticket, which runs beside this one. The Perminister leg itself: ticket 02.
- Turning DCR on, or a client secret flow: out of scope.

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/auth/oauth-flow.test.ts --reporter=verbose`
  passes and its output contains the `prints` lines below.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/auth/oauth-flow.test.ts --reporter=verbose
prints oauth: a CIMD client completes authorize to token with PKCE to the claude.ai callback
prints oauth: a loopback redirect on any port is accepted
prints oauth: a redirect URI the metadata does not list is refused
prints oauth: a token request without the PKCE verifier is refused
prints oauth: a reused code answers invalid_grant
prints oauth: a refresh token rotates and a dead one answers invalid_grant
prints oauth: an unknown CIMD client is refused
prints consent: Deny returns access_denied to the client
prints pages: the consent page cannot be framed
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Stories (claude.ai adds sky-brain; Hostile callers), § Interfaces, § UI.
- map.md (the full-flow spike line: what each step answered).
- `apps/server/src/testing/auth-harness.ts` (new in ticket 02).

## Answer

Work started at `4ed4758bd2fd96fe631c704467348fd69eb50230`; failing test committed alone first.

**Built**

- `apps/server/src/auth/pages/consent.ts`: the consent page HTML (ids `client-name`, `email`,
  `redirect-host`, `scopes`, buttons `allow`, `deny`, one `<script src="/auth-pages/consent.js"
  defer>`, no inline script) and its ES5 script: reads `client_id`, `redirect_uri`, `scope` from
  `location.search`; `#redirect-host` = `new URL(redirect_uri).host` (Allow disabled when it does
  not parse); `#scopes` = the requested `brain:*` scopes without the prefix ("read, write");
  client name from `GET /api/auth/oauth2/public-client?client_id=`, email from
  `GET /api/auth/get-session`; every field through `textContent`. Allow/Deny post
  `{accept, oauth_query: location.search.slice(1)}` to `/api/auth/oauth2/consent` and go to the
  returned `url`. No route change: `routes.ts` already serves it.
- `apps/server/src/auth/oauth-flow.test.ts` (new, 397 lines): the nine named tests plus
  "oauth: a forged or altered oauth_query is refused" (followups.md, 03 item 1).

**Proof**

- `pnpm --filter @sky-brain/server exec vitest run src/auth/oauth-flow.test.ts --reporter=verbose`:
  exit 0, `Tests 10 passed (10)`; the output lists all nine `prints` lines (plus the forged
  oauth_query test). At the test-only commit the same command failed only "pages: the consent
  page cannot be framed" (`expected 404 to be 200`), 9 passed: Better Auth already does the
  protocol; the page was the missing piece.
- `pnpm lint && pnpm typecheck && pnpm test`: exit 0; shared 15 passed, server 21 files, 288 passed.
- The consent script was also run once by hand against a stub DOM (scratch, not committed): it
  showed `redirect-host` `claude.ai`, `scopes` `read, write`, a client name `<b>Claude</b>` as
  literal text, and Deny posted `{"accept": false, "oauth_query": <the page query unchanged>}`
  then assigned the returned `url`.

**Decisions**

- What Better Auth 1.7.15 answered (now pinned by the tests): claude.ai flow: code at
  `https://claude.ai/api/mcp/auth_callback` with the same `state` and `iss=<url>/api/auth`; token
  `aud` includes `<url>/mcp`, `iss` `<url>/api/auth`, `azp` the client id. Loopback
  `localhost:53682` and `127.0.0.1:3118` accepted for a client registered without a port.
  Unlisted redirect URI (another host, or the claude.ai path with a suffix) ends at
  `/api/auth/error?error=invalid_redirect`, no code. Token without `code_verifier`: 400
  `invalid_request` ("Either code_verifier or client_secret is required"), not `invalid_grant`;
  wrong verifier: 400 `invalid_grant`. Reused code: 400 `invalid_grant`. Refresh: rotates (new
  refresh token); made-up one: 400 `invalid_grant`; one revoked through
  `POST /api/auth/oauth2/revoke` (form, `token_type_hint=refresh_token`, `client_id`; 200): 400
  `invalid_grant`. Unknown CIMD client (fake fetch 404): authorize answers 400
  `{"error":"invalid_client"}` directly, no redirect. Deny: `<redirect_uri>?error=access_denied`
  with the same `state`, no code. An unsigned `oauth_query` on `sign-in/social`, or a signed
  consent query with `redirect_uri` swapped on `oauth2/consent`: 400 `{"error":"invalid_signature"}`,
  no Perminister URL, no redirect. So the 03 follow-up holds: sign-in.js forwarding any query is
  safe; nothing to change there.
- Deny and the forged-consent test use `prompt=consent` on authorize, so they reach the consent
  page even after this person allowed the client earlier in the file (consent is remembered).
- Scopes shown as the `brain:*` names from the page's own query; with none, "your sign-in only".
- JWT claims are read by base64url-decoding the payload in the test (no signature check):
  `jose` is not a direct dependency of `apps/server` and `package.json` is outside Touches.

**Shortcuts taken**

- The consent script is proven by string checks and one hand run against a stub DOM, not a
  browser test (the repo has no DOM test setup). It stops being enough if the page grows logic;
  then add a jsdom/happy-dom test.
- The test decodes the access token without verifying it; ticket 05 verifies tokens at `/mcp`.

**For later tickets**

- 05: after the Perminister callback (`/api/auth/callback/perminister`), the response is 302
  `Location: /` with a body `{"redirect": true, "url": "/consent?..."}`; the harness's `next`
  prefers `Location`, so follow `body.url` first (see `authorizeAndSignIn` in
  `oauth-flow.test.ts`; spec.md step 3 reads as if `next` were already the consent URL).
- A second flow for the same person and client skips consent and lands on the client redirect;
  pass `prompt=consent` to force the page.
- A missing verifier answers `invalid_request`, not `invalid_grant`; spec.md's edge case says only
  "Token endpoint refuses" and `acceptance/hostile.test.ts` accepts any error string, so nothing
  conflicts.

