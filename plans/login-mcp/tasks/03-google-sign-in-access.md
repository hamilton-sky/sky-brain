# Decide who may sign in, give each person their own workspace, accept invites on every sign-in, add the sign-in page and the session resolver

Type: task
Status: open
Blocked by: 02
Test first: yes
Level: 3
Touches: apps/server/src/auth/access.ts, apps/server/src/auth/access.test.ts, apps/server/src/auth/on-sign-in.ts, apps/server/src/auth/on-sign-in.test.ts, apps/server/src/auth/auth.ts, apps/server/src/auth/session-resolver.ts, apps/server/src/auth/session-resolver.test.ts, apps/server/src/auth/pages/sign-in.html, apps/server/src/auth/pages/sign-in.js, apps/server/src/app.ts, docs/PLAN.md, docs/DECISIONS.md

T3's core: who gets in, what they get on sign-in, and how `/api/v1` learns who is calling. Uses
ticket 02's `createAuth` (its `bootstrapOwnerEmail` and `allowedEmails` options), `mountAuth` and
`startAuthTestServer`.

**Who may sign in** (`auth/access.ts`, new). One exported function holds the whole rule, so it can
be opened later (spec.md Decisions):

```ts
mayEnter(who: { email: string; emailVerified: boolean },
         rules: { bootstrapOwnerEmail?: string; allowedEmails: string[] }): boolean
```

True only when `emailVerified` is true and the email, trimmed and lower-cased, equals
`bootstrapOwnerEmail` or is in `allowedEmails` (shammai's decision: an allowlist, not any Google
account). An invite alone does not let anyone in: it adds a person who is already allowed to
another owner's workspace. A later rule (any Google account, or invites that admit) changes this
one function and its callers only. `createAuth` wires it as Better Auth's `user.validateUserInfo` and returns
`{ error: "no_access" }` when it is false. That hook runs before the user is created **and on
every later Google sign-in** with the fresh Google profile (map.md, round 3 spike), so a person
taken off `ALLOWED_EMAILS` is refused at their next sign-in; Better Auth then redirects to the
`errorCallbackURL` with `?error=no_access` and writes no session. Do not also use
`databaseHooks.user.create.before` for access.

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
`user` table. The bootstrap owner is only always allowed; their workspace comes from step 1 like
everyone else's.

**Session resolver** (`auth/session-resolver.ts`, new): `sessionActorResolver(auth)` returns an
`ActorResolver` that calls `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })` and
returns `{ kind: "human", user_id }` parsed with `ActorSchema` (a user id that does not fit gives
undefined, so 401), or undefined with no session. It reads only the session cookie, never a
bearer token or the body. `createApp` uses `sessionActorResolver(options.auth.instance)` as the
default `resolveActor` when `auth` is given and `resolveActor` is not; `actorMiddleware`'s order is
unchanged, so the `X-Dev-Actor` rules of D15 still come first.

**Sign-in page** (`auth/pages/sign-in.html` and `sign-in.js`, new; served by ticket 02's routes):
the elements spec.md Interfaces → The pages names (`#google`, and `#no-access`, hidden, already
holding "No access", the text in spec.md § UI and a "Try another account" button), and
`<script src="/auth-pages/sign-in.js" defer>`. The script posts `{ provider: "google", callbackURL:
"/", errorCallbackURL: "/sign-in", oauth_query: location.search.slice(1) }` to
`/api/auth/sign-in/social` and goes to the returned `url`. With an `error` query parameter it
removes `hidden` from `#no-access` and hides `#google`; "Try another account" goes back to
`/sign-in` with the query minus `error`. No inline script (the CSP is `default-src 'self'`); text
set only with `textContent`. ESLint lints the file with Node globals: declare the browser ones it
uses in a `/* global document, location, fetch */` comment.

**Docs.** `docs/PLAN.md` section 9: replace "Only invited emails get into a workspace" with: who
may sign in is `ALLOWED_EMAILS` plus `BOOTSTRAP_OWNER_EMAIL`; each person gets their own workspace
(owner) at first sign-in; an invite adds an allowed person to another owner's workspace and is
accepted at their next sign-in; everyone else, invited or not, sees "No access". The "Until then (D15)" line says
the dev header stays for `pnpm dev` while sign-in is the real path. `docs/DECISIONS.md` gains
`### D16. One workspace per person, and an ALLOWED_EMAILS allowlist` (login-mcp owns D16 to D18):
one workspace per person at first sign-in, the `ALLOWED_EMAILS` allowlist (shammai's choice over
any Google account) in `mayEnter`, invites accepted on every sign-in for allowed people, workspaces walled off by membership (hard rule 4).

Tests (allowed and refused cases, CLAUDE.md), through `startAuthTestServer` driving
`sign-in/social` and the Google callback as spec.md Interfaces shows, plus `mayEnter` directly:
- "access: mayEnter allows the bootstrap owner and the allowlist, in any case" — and refuses an
  unverified email, an email on neither, and an email that has only an invite.
- "sign-in: an allowed person gets their own workspace as owner once" — an `ALLOWED_EMAILS`
  person signs in twice; one workspace, one `owner` row, named after the email.
- "sign-in: the bootstrap owner gets in without being on the allowlist" — own workspace, `owner`.
- "sign-in: two people get two walled-off workspaces" — `memberRole` of each for the other's
  workspace is undefined, and `resolveScope` for the other's workspace throws 404 (hard rule 4).
- "sign-in: an allowed person with an invite gets the invite's role" — on the allowlist, invite
  seeded in another case; own workspace as `owner` plus a `members` row with the invite's
  `editor` role, `accepted_at` set.
- "sign-in: an invited email not on the allowlist gets no access" — `error=no_access`, no `user`
  row, the invite still pending.
- "sign-in: an invite to an existing account is accepted at the next sign-in" — the person signs
  in, then an invite is seeded, then they sign in again; `members` row added, `accepted_at` set,
  still one own workspace.
- "sign-in: an email not allowed gets no access" — `next` is `/sign-in?error=no_access...`, no
  `user` row, no session cookie; `GET /sign-in?error=no_access` answers 200 HTML containing
  `id="no-access"` and `No access`, and `GET /auth-pages/sign-in.js` contains `no-access`.
- "sign-in: a person taken off the allowlist gets no access at the next sign-in" — build the
  harness twice on one `db`: first with the email allowed, then without; second sign-in gives
  `error=no_access` and no session cookie.
- "sign-in: an unverified Google email gets no access".
- "session: a signed-in person reaches /api/v1 as a human" — with the cookie, an unknown `/api/v1`
  path answers 404; without it, 401 `unauthenticated`.
- "session: the dev actor header is still refused when off" — cookie plus `X-Dev-Actor` → 401
  `dev_actor_disabled`.
- "pages: the sign-in page cannot be framed" — `GET /sign-in` has `frame-ancestors 'none'`.

## Not in this ticket

- The consent page and the OAuth authorize → token tests: ticket 04.
- `whoami`'s list of workspaces: ticket 05.
- An owner route or page to create or revoke invites: later (T4 human routes, T8 web page); tests
  seed rows. Removing someone means taking them off `ALLOWED_EMAILS` until then.
- The cloud task board: a separate later feature.
- Bearer tokens on `/api/v1` (run tokens): T7.

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/auth --reporter=verbose` passes and its
  output contains the `prints` lines below.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/auth --reporter=verbose
prints access: mayEnter allows the bootstrap owner and the allowlist, in any case
prints sign-in: an allowed person gets their own workspace as owner once
prints sign-in: the bootstrap owner gets in without being on the allowlist
prints sign-in: two people get two walled-off workspaces
prints sign-in: an allowed person with an invite gets the invite's role
prints sign-in: an invited email not on the allowlist gets no access
prints sign-in: an invite to an existing account is accepted at the next sign-in
prints sign-in: an email not allowed gets no access
prints sign-in: a person taken off the allowlist gets no access at the next sign-in
prints sign-in: an unverified Google email gets no access
prints session: a signed-in person reaches /api/v1 as a human
prints session: the dev actor header is still refused when off
prints pages: the sign-in page cannot be framed
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Stories (A person signs in with Google), § Edge cases, § Decisions, § UI.
- map.md (the round 3 hook spike, the `Origin` and JSON-redirect quirks).
- `apps/server/src/actor/middleware.ts`, `apps/server/src/scope/member-role.ts`,
  `apps/server/src/scope/resolve-scope.ts`, `apps/server/src/db/schema.ts` (`workspaces`,
  `members`, `invites`), `apps/server/src/testing/harness.ts` (`seedWorkspace`).

## Answer
