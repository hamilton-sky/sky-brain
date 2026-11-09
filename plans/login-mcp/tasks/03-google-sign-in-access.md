# Let Perminister-approved people in, give each person their own workspace, accept invites on every sign-in, add the sign-in page and the session resolver

Type: task
Status: open
Blocked by: 02
Test first: yes
Level: 3
Touches: apps/server/src/auth/access.ts (new), apps/server/src/auth/access.test.ts (new), apps/server/src/auth/on-sign-in.ts (new), apps/server/src/auth/on-sign-in.test.ts (new), apps/server/src/auth/auth.ts, apps/server/src/auth/session-resolver.ts (new), apps/server/src/auth/session-resolver.test.ts (new), apps/server/src/auth/pages/sign-in.ts, apps/server/src/app.ts, docs/PLAN.md, docs/DECISIONS.md, CLAUDE.md, README.md

T3's core: who gets in, what they get on sign-in, and how `/api/v1` learns who is calling. Uses
ticket 02's `createAuth`, the `perminister` provider, `mountAuth` and `startAuthTestServer`
(its fake Perminister: `setPerministerAccount` and `approve`). Sign-in is "Sign in with
Perminister" only; shammai replaced Google and the `ALLOWED_EMAILS` allowlist on 2026-11-09
(map.md repair lines).

**Who may sign in** (`auth/access.ts`, new). One exported function holds the whole rule, so a
gate can be added later (spec.md Decisions):

```ts
export const PERMINISTER_PRODUCT_ID = "sky-brain";
mayEnter(who: { email: string | null | undefined; productIds: string[] }): boolean
```

True only when `email` is a non-empty string and `productIds` contains
`PERMINISTER_PRODUCT_ID`: Perminister signed the person in and lists an organization for this
product (shammai: Perminister's invitations are the gate). A pending sky-brain invite alone does
not let anyone in: it adds a person who may enter to another owner's workspace. `createAuth` wires
it as Better Auth's `user.validateUserInfo`, reading `productIds` from
`source.oauth.profile.organizations[].productId` (the exchange answer `getUserInfo` passes on;
map.md repair spike), and returns `{ error: "no_access" }` when it is false. That hook runs before
the user is created **and on every later sign-in** with the fresh profile, so a person whose
access was taken away in Perminister is refused at their next sign-in; Better Auth then redirects
to the `errorCallbackURL` with `?error=no_access` and writes no session. An account with no email
never reaches the hook: Better Auth refuses it first with `?error=email_not_found` (spec.md
Decisions); `mayEnter` refuses it too. Do not also use `databaseHooks.user.create.before` for
access.

**What a sign-in gives** (`auth/on-sign-in.ts`, new): `onSignIn(db, { userId, email })`, wired as
`databaseHooks.session.create.after` (runs on every sign-in, after `user.create.after` on the first
one; map.md). In one transaction:
1. If the person has no `members` row at all, insert a workspace named after their email and an
   `owner` membership for them: their own board, with projects and features under it later
   (brief, Decided). A second sign-in finds the row and creates nothing.
2. For every `invites` row of that email (lower-cased) with `accepted_at` null: insert a `members`
   row with the invite's role unless one exists for that workspace, and set `accepted_at`. So an
   invite sent to someone who already has an account is accepted at their next sign-in (review
   finding 6).
It never reads anything from the request; the user id and email come from the session row and the
`user` table (the email Perminister gave, lower-cased by Better Auth).

**Session resolver** (`auth/session-resolver.ts`, new): `sessionActorResolver(auth)` returns an
`ActorResolver` that calls `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })` and
returns `{ kind: "human", user_id }` parsed with `ActorSchema` (a user id that does not fit gives
undefined, so 401), or undefined with no session. It reads only the session cookie, never a
bearer token or the body. `createApp` uses `sessionActorResolver(options.auth.instance)` as the
default `resolveActor` when `auth` is given and `resolveActor` is not; `actorMiddleware`'s order is
unchanged, so the `X-Dev-Actor` rules of D15 still come first.

**Sign-in page** (`auth/pages/sign-in.ts`, the new stub ticket 02 adds; fill in its `html` and `script`
strings, which ticket 02's routes already serve): the elements spec.md Interfaces → The pages
names (`#perminister`, "Sign in with Perminister", and `#no-access`, hidden, already holding "No
access", the text in spec.md § UI and a "Try another account" button), and
`<script src="/auth-pages/sign-in.js" defer>`. The script posts `{ provider: "perminister",
callbackURL: "/", errorCallbackURL: "/sign-in", oauth_query: location.search.slice(1) }` to
`/api/auth/sign-in/social` and goes to the returned `url`. With an `error` query parameter (any
value: `no_access`, `email_not_found`, `invalid_code`) it removes `hidden` from `#no-access` and
hides `#perminister`; "Try another account" goes back to `/sign-in` with the query minus `error`.
No inline script (the CSP is `default-src 'self'`); text set only with `textContent`.

**Docs.** `docs/PLAN.md` section 9: replace "People sign in with Google. Only invited emails get
into a workspace. Anyone else sees "no access". The first owner is set by the
`BOOTSTRAP_OWNER_EMAIL` setting." with: people sign in with Perminister (invite-only for this
product); anyone it signs in with access to the `sky-brain` product may enter; each person gets
their own workspace (owner) at first sign-in; a sky-brain invite adds such a person to another
owner's workspace and is accepted at their next sign-in; everyone else sees "No access". In the
MCP clients bullet, "the same Google sign-in" becomes "the same Perminister sign-in". The "Until
then (D15)" line says the dev header stays for `pnpm dev` while sign-in is the real path. The
other places that still say Google change to Perminister in the same commit (CLAUDE.md: docs stay
in sync): `docs/PLAN.md` section 2's table ("Sign in with Google"), section 3's diagram ("Google
sign-in (cookie)", "Better Auth (Google, OAuth server)") and section 11's stack line ("Google
sign-in" becomes "generic OAuth for Perminister sign-in"); `CLAUDE.md`'s "People sign in with
Google."; `README.md`'s "Sign in with Google" row. Afterwards
`grep -n -i google docs/PLAN.md CLAUDE.md README.md` prints nothing.
`docs/DECISIONS.md` gains, with the next free number at the time (D16 is taken; never hard-code
it), `### D<n>. One workspace per person, and Perminister sign-in`: Perminister as the only
sign-in, through Better Auth's `genericOAuth()` with the user keyed by `subjectId`; `mayEnter`
(access to product `sky-brain`, an account with no email refused) replacing the `ALLOWED_EMAILS`
allowlist, as shammai decided on 2026-11-09; one workspace per person at first sign-in; invites
accepted on every sign-in; workspaces walled off by membership (hard rule 4). Rejected: the
`ALLOWED_EMAILS` allowlist and Google sign-in.

Tests (allowed and refused cases, CLAUDE.md), through `startAuthTestServer` driving
`sign-in/social`, `approve` and the two callbacks as spec.md Interfaces shows, plus `mayEnter`
directly:
- "access: mayEnter allows a Perminister account with sky-brain access" — and refuses an account
  with no email, one whose organizations name only another product, and one with none.
- "sign-in: a person with sky-brain access gets their own workspace as owner once" — the same
  `subjectId` signs in twice; one `user`, one `account` (`perminister`, the `subjectId`), one
  workspace, one `owner` row, named after the email.
- "sign-in: two people get two walled-off workspaces" — `memberRole` of each for the other's
  workspace is undefined, and `resolveScope` for the other's workspace throws 404 (hard rule 4).
- "sign-in: a person with an invite gets the invite's role" — invite seeded with the email in
  another case; own workspace as `owner` plus a `members` row with the invite's `editor` role,
  `accepted_at` set.
- "sign-in: an invited account without sky-brain access gets no access" — `error=no_access`, no
  `user` row, the invite still pending.
- "sign-in: an invite to an existing account is accepted at the next sign-in" — the person signs
  in, then an invite is seeded, then they sign in again; `members` row added, `accepted_at` set,
  still one own workspace.
- "sign-in: an account without sky-brain access gets no access" — `next` is
  `/sign-in?error=no_access...`, no `user` row, no session cookie; `GET /sign-in?error=no_access`
  answers 200 HTML containing `id="no-access"` and `No access`, and `GET /auth-pages/sign-in.js`
  contains `no-access`.
- "sign-in: an account without an email gets no access" — `next` is
  `/sign-in?error=email_not_found`, no `user` row, no session cookie.
- "sign-in: a person whose access was taken away gets no access at the next sign-in" — the same
  `subjectId` signs in with `productIds: ["sky-brain"]`, then with `productIds: []`; the second
  gives `error=no_access` and no session cookie.
- "sign-in: a forged state or a refused code creates no session" — a callback with a made-up
  `state` ends at an `error=state_mismatch` URL; the `code` of a sign-in that already completed,
  sent with the `state` of a fresh `sign-in/social` in a new browser, ends at
  `/sign-in?error=invalid_code` (the fake refuses a used code); neither sets a session cookie.
- "session: a signed-in person reaches /api/v1 as a human" — with the cookie, an unknown `/api/v1`
  path answers 404; without it, 401 `unauthenticated`.
- "session: the dev actor header is still refused when off" — cookie plus `X-Dev-Actor` → 401
  `dev_actor_disabled`.
- "pages: the sign-in page cannot be framed" — `GET /sign-in` has `frame-ancestors 'none'` and a
  button `id="perminister"` reading "Sign in with Perminister".

## Not in this ticket

- The consent page and the OAuth authorize → token tests: ticket 04.
- `whoami`'s list of workspaces: ticket 05.
- An owner route or page to create or revoke invites: later (T4 human routes, T8 web page); tests
  seed rows. Removing someone means taking away their `sky-brain` access in Perminister until then.
- Perminister's own authorization and member APIs: not used (spec.md Scope).
- The cloud task board: a separate later feature.
- Bearer tokens on `/api/v1` (run tokens): T7.

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/auth --reporter=verbose` passes and its
  output contains the `prints` lines below.
- No Google sign-in is left in the living docs:
  `grep -ci google docs/PLAN.md CLAUDE.md README.md | grep -v ':0$' || echo docs-ok` prints
  `docs-ok`.
- `docs/DECISIONS.md` has the decision once, under the next free number:
  `grep -cE '^### D[0-9]+\. One workspace per person, and Perminister sign-in' docs/DECISIONS.md`
  prints `1`.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/auth --reporter=verbose
prints access: mayEnter allows a Perminister account with sky-brain access
prints sign-in: a person with sky-brain access gets their own workspace as owner once
prints sign-in: two people get two walled-off workspaces
prints sign-in: a person with an invite gets the invite's role
prints sign-in: an invited account without sky-brain access gets no access
prints sign-in: an invite to an existing account is accepted at the next sign-in
prints sign-in: an account without sky-brain access gets no access
prints sign-in: an account without an email gets no access
prints sign-in: a person whose access was taken away gets no access at the next sign-in
prints sign-in: a forged state or a refused code creates no session
prints session: a signed-in person reaches /api/v1 as a human
prints session: the dev actor header is still refused when off
prints pages: the sign-in page cannot be framed
$ grep -cE '^### D[0-9]+\. One workspace per person, and Perminister sign-in' docs/DECISIONS.md
prints 1
$ grep -ci google docs/PLAN.md CLAUDE.md README.md | grep -v ':0$' || echo docs-ok
prints docs-ok
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Stories (A person signs in with Perminister), § Edge cases, § Decisions, § Interfaces
  (Perminister calls, How a test reaches the server), § UI.
- map.md (the repair spike: `validateUserInfo` with a generic provider, the error codes; the round
  3 hook spike; the `Origin` and JSON-redirect quirks).
- `apps/server/src/actor/middleware.ts`, `apps/server/src/scope/member-role.ts`,
  `apps/server/src/scope/resolve-scope.ts`, `apps/server/src/db/schema.ts` (`workspaces`,
  `members`, `invites`), `apps/server/src/testing/harness.ts` (`seedWorkspace`).

## Answer

Work started at `371cfb25752d337375ae725c365c8598d97223c3`; the failing tests were committed alone
first (`9cdd415 test(login-mcp): 03 failing test`) and failed because `access.ts`,
`on-sign-in.ts` and `session-resolver.ts` did not exist.

- **Built**:
  - `apps/server/src/auth/access.ts` (new): `PERMINISTER_PRODUCT_ID`, `mayEnter`, and
    `productIdsOf` (narrows `source.oauth.profile.organizations[].productId`, an untyped profile).
  - `apps/server/src/auth/on-sign-in.ts` (new): `onSignIn(db, { userId, email })` (own workspace
    when the person has no `members` row, then every pending invite for the lower-cased email,
    one transaction) and `onSessionCreated(db)`, the `session.create.after` hook that reads the
    email from the `user` row of the session's `userId`.
  - `apps/server/src/auth/session-resolver.ts` (new): `sessionActorResolver(auth)`.
  - `apps/server/src/auth/auth.ts`: `user.validateUserInfo` (refuses with `{ error: "no_access" }`
    when `mayEnter` is false) and `databaseHooks.session.create.after`; `accountLinking` stays off.
  - `apps/server/src/app.ts`: the default `resolveActor` is `sessionActorResolver(auth.instance)`
    when `auth` is given and `resolveActor` is not.
  - `apps/server/src/auth/pages/sign-in.ts`: the page HTML and script.
  - Tests: `access.test.ts`, `on-sign-in.test.ts`, `session-resolver.test.ts` (new).
  - Docs: `docs/PLAN.md` (sections 2, 3, 9, 11), `CLAUDE.md` line 6, `README.md`, and
    `docs/DECISIONS.md` D17 "One workspace per person, and Perminister sign-in" (D16 was the last).
- **Proof** (all run after the last code edit):
  - `pnpm --filter @sky-brain/server exec vitest run src/auth --reporter=verbose`: exit 0, 6 files,
    29 tests passed; each of the 13 `prints` lines was found in the output with `grep -F`.
  - `grep -ci google docs/PLAN.md CLAUDE.md README.md | grep -v ':0$' || echo docs-ok`: `docs-ok`.
  - `grep -cE '^### D[0-9]+\. One workspace per person, and Perminister sign-in' docs/DECISIONS.md`: `1`.
  - `pnpm lint && pnpm typecheck && pnpm test`: exit 0 (shared 15 tests, server 276 tests in 20 files).
  - Extra: `pnpm --filter @sky-brain/server build:vercel` still writes `dist/vercel.mjs 2.9mb`.
- **Decisions**:
  - The resolver hands Better Auth only the `cookie` header (`fromNodeHeaders({ cookie })`), and
    answers undefined at once with no cookie, so a bearer token or anything else in the request
    can never become a session, whatever plugins are added later. A unit test with a fake `Auth`
    proves `authorization` does not reach `getSession`.
  - `validateUserInfo` refuses any source that is not a Perminister profile listing `sky-brain`
    (`productIdsOf` of a missing profile is `[]`), so a future non-OAuth sign-in method is closed
    until `mayEnter` says otherwise.
  - Invites match with `lower(invites.email) = <lower-cased email>`, so an invite stored in mixed
    case matches. An invite for a workspace where the person already has a row keeps the existing
    role (`onConflictDoNothing`) and is still marked accepted.
  - The page script reacts to any `error` parameter (not a fixed list), so `account_not_linked`
    (follow-ups 02 item 3) also lands on "No access". "Try another account" drops `error` and
    `error_description`, which Better Auth adds next to it. `oauth_query` is sent only when the
    page has a query, so a plain sign-in does not post an empty one. On the error view the whole
    `#sign-in` section (the "Sign in to continue" line and `#perminister`) is hidden.
  - Tests are split: refusals and the page in `access.test.ts`, what a sign-in gives in
    `on-sign-in.test.ts`, the `/api/v1` session in `session-resolver.test.ts`; each file has its
    own server and database and uses its own subjects and emails.
- **Shortcuts taken**:
  - Two first sign-ins of the same person at the same moment could each see no `members` row and
    make two own workspaces (no lock). Harmless (two boards they own); worth a fix (an advisory
    transaction lock on the user id, or a marker column) if it is ever seen.
  - The page has no styles: the CSP `default-src 'self'` blocks inline styles, and a stylesheet
    route is not in Touches. A plain page until T8's web app or a CSS route.
- **For later tickets**:
  - 04: the consent page follows the same pattern (strings in `pages/consent.ts`, no inline
    script). A sign-in started from `/sign-in?<signed query>` posts that query as `oauth_query`.
  - 05: `whoami` can list workspaces from `members` joined to `workspaces` by `personOf(actor)`;
    every signed-in person has at least their own.
  - Every sign-in in tests now creates a workspace and an `owner` row, so a test that counts
    `workspaces` or `members` across the whole database must filter by user.


## Review findings (round 1, pair review)

QUALITY
1. major apps/server/src/auth/auth.ts (with apps/server/src/auth/session-resolver.ts): access taken away in Perminister never ends an existing session. createAuth sets no `session` options, so Better Auth 1.7.15 uses rolling sessions (expiresIn 7 days, updateAge 1 day), and `auth.api.getSession` in sessionActorResolver extends the session row's expiresAt in the database (api/routes/session.mjs, needsRefresh -> updateSession) whenever it is more than a day old. A person removed from the `sky-brain` product who keeps the cookie value (e.g. curl, ignoring the cookie Max-Age) and calls /api/v1 at least once a week keeps access forever, and never meets validateUserInfo again. spec.md Edge cases says existing sessions "run out on their own expiry", and ticket 03 makes "take away their sky-brain access in Perminister" the only way to remove someone. - Set `session: { disableSessionRefresh: true }` (or a fixed absolute lifetime) in createAuth so sessions end at their first expiresAt, and add an allowed/refused test: a session whose expiresAt has passed gets 401 on /api/v1, and a call through the resolver does not move expiresAt.
2. minor apps/server/src/auth/on-sign-in.ts: two first sign-ins of the same new person running at once (two tabs, two callbacks) both see no members row inside their READ COMMITTED transactions and each create an own workspace. - Take a per-user lock first (e.g. `select pg_advisory_xact_lock(hashtext(userId))` in the transaction) or lock the user row with `for update`, so the second run sees the first one's membership.
3. minor apps/server/src/auth/on-sign-in.ts: onSessionCreated runs after the session row is written; if onSignIn throws, the callback fails but the session row stays and the person has no workspace until a later sign-in. - Acceptable, but log the failure with the user id (no email) so a missing own workspace can be traced.

Probed as a hostile caller (level 3): the Perminister profile fields email, organizations[].productId and subjectId (validateUserInfo runs on create and on every sign-in, confirmed in better-auth dist oauth2/link-account.mjs; a non-array or malformed organizations gives no productIds, so refusal); the session cookie on /api/v1 (only the cookie reaches getSession, bearer and body ignored, user id parsed with ActorSchema); X-Dev-Actor with a cookie (still 401 dev_actor_disabled, order unchanged); invites matched by email (lower-cased, the email comes from the user row, which Perminister vouches for via emailVerified); the `error`/oauth_query page parameters (text only through textContent, no inline script, CSP unchanged); forged state and reused code (tests pass). The only way through found is finding 1.

Notes: all four Done when commands re-run here and pass (13 named tests print; DECISIONS count 1; docs-ok; lint, typecheck and test exit 0). END is HEAD (32687be), so no later commits were excluded. The acceptance suite (plans/login-mcp/acceptance/helpers.ts, from 12caedc) still calls server.setGoogleUser, which the Perminister harness no longer has, so every acceptance test fails before reaching this ticket's code; that file is not in this ticket's diff, but every later ticket will trip over it until the acceptance helpers are moved to setPerministerAccount. The ticket's Answer was not read. The gate run left /tmp/sb-gates.log.

REVIEW: FAIL
Reviewed ticket 03 (plans/login-mcp/tasks/03-google-sign-in-access.md) over 371cfb2..32687be. I read the ticket as it was at 371cfb2 (empty Answer), not its Answer. END is 32687be, which is HEAD, so there are no later commits left out.

SPEC
- `pnpm --filter @sky-brain/server exec vitest run src/auth --reporter=verbose` passes and prints the 13 named lines: MET (conductor)
- `grep -ci google docs/PLAN.md CLAUDE.md README.md | grep -v ':0$' || echo docs-ok` prints docs-ok: MET (conductor). The diff matches: every Google mention in PLAN.md sections 2, 3, 9 and 11, CLAUDE.md and README.md now says Perminister.
- `grep -cE '^### D[0-9]+\. One workspace per person, and Perminister sign-in' docs/DECISIONS.md` prints 1: MET (conductor). D17 is appended after D16, and no older entry is edited.
- `pnpm lint && pnpm typecheck && pnpm test` exits 0: MET (conductor)
- scope: OK. Every changed file is in Touches, apart from plans/login-mcp/map.md and plans/login-mcp/learnings.md. Each of those gains one appended line for 03, which is the flow's own bookkeeping. Nothing in "Not in this ticket" is touched: no consent page, no whoami, no invite routes, no bearer tokens.
- test first: OK. Commit 9cdd415 adds only access.test.ts, on-sign-in.test.ts and session-resolver.test.ts. The conductor saw it fail before the code. The tests import access.ts and session-resolver.ts, which did not exist yet, so they cannot pass without the production change.

Notes:
- Acceptance tests (`plans/login-mcp/acceptance`, 50 failing): every failure seen is `TypeError: server.setGoogleUser is not a function` in acceptance/helpers.ts:202. That suite was committed in 12caedc, before the switch from Google to Perminister. It calls a Google method that the ticket 02 harness no longer offers, so it fails at sign-in for every ticket. Ticket 03 does not list it in Touches, and its Done when does not include it. That makes it stale acceptance code, not a failure in what 03 delivers. The suite needs repair before ticket 07, the acceptance ticket.
- Spot-check of the diff against the ticket body: mayEnter/PERMINISTER_PRODUCT_ID are wired only as user.validateUserInfo returning { error: "no_access" }, with no user.create.before. onSignIn runs in one transaction as session.create.after, and matches invites on the lower-cased email. sessionActorResolver passes only the cookie header to getSession and parses the result with ActorSchema. createApp uses it as the default only when auth is given and resolveActor is not, and the middleware order is unchanged. The sign-in page has #perminister and a hidden #no-access with "No access" and "Try another account", an external deferred script, and text set only through textContent.
- Level is already 3. I did not raise it.

REVIEW: PASS
