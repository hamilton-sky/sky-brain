# Add the consent page and prove the CIMD authorize → token flow with PKCE

Type: task
Status: open
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
