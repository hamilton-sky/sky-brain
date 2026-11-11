# Prove the bar on a fresh clone and after deploy, and record what worked

Type: task
Status: resolved
Blocked by: 05, 06, 08
Test first: no
Level: 1
Builder: docs
Touches: docs/CONNECT.md, docs/DECISIONS.md

The acceptance ticket: both halves of map.md's bar, against what is committed.

1. Clone the committed `HEAD` into a temporary folder and run
   `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` there; then
   `pnpm --filter @sky-brain/server exec vitest run src/mcp/claude-flow.test.ts --reporter=verbose`.
   Paste the summary lines under Answer → Proof.
2. The manual half needs shammai (his Perminister app client and Vercel project): set the
   variables and register the client as `docs/CONNECT.md` (new in ticket 06) says, deploy to
   `https://sky-brain.vercel.app`, then add the connector in claude.ai and ask for `whoami`. It
   must return shammai's email. Also try the phone app and Claude Code CLI, a Perminister account
   without `sky-brain` access (it must end at "No access"), and note how long the first discovery
   and token calls took after a cold start (claude.ai waits at most 10 seconds). The builder
   cannot do this alone: write the steps and what to look for under Answer, and fill in the
   results shammai reports.
3. In the `## Verified` section of `docs/CONNECT.md` (new in ticket 06), replace the placeholder
   with `- claude.ai whoami: returned <the email whoami returned> on <YYYY-MM-DD>`, then add one
   line each for the phone app, Claude Code, the account without access, the cold-start timing, the steps that differed from
   the doc, and whether Codex CLI needed DCR. Write only what shammai reports; never fill the
   claude.ai line before he has seen it.
4. `docs/DECISIONS.md`: a decision headed `### D<n>. T0 result: <outcome>`, `<n>` the next free
   number at the time (D16 is Vercel; ticket 03 takes one; never hard-code it), recording the T0
   result and the auth setup it tested (sign-in with Perminister through Better Auth's
   `genericOAuth()`, users keyed by Perminister `subjectId`; Better Auth 1.7.15 with
   `@better-auth/mcp` and `@better-auth/cimd` pinned exactly; issuer `<PUBLIC_URL>/api/auth`;
   resource `<PUBLIC_URL>/mcp`; CIMD on with the resolve-once transport; DCR off; MCP callers are
   agents `mcp/<client host>` acting for the token's person across their workspaces;
   `legacy: "stateless"`; scopes advertised, not yet required): Better Auth kept
   (claude.ai, the phone app and Claude Code all passed), or, if a client failed and could not be
   fixed in two days, the switch to WorkOS AuthKit as the new decision (D7's fallback).

## Not in this ticket

- Fixing a failure the manual check finds: a new ticket in this plan (next number), or the
  WorkOS decision above.
- README status: README describes brain-core; the web page feature (T8) updates it.

## Done when

- The fresh-clone run exits 0 and the end-to-end test passes (Answer → Proof holds the output).
- The deploy answers the `/mcp` challenge: with `PUBLIC_URL` set to the deployed address,
  `curl -sS -o /dev/null -w 'status %{http_code}' -X POST "$PUBLIC_URL/mcp"` prints `status 401`,
  and its protected resource metadata names `/mcp`.
- `docs/CONNECT.md` (new in ticket 06) records claude.ai's `whoami` result:
  `grep -E '^- claude\.ai whoami: returned [^ @]+@[^ ]+ on 20[0-9]{2}-[0-9]{2}-[0-9]{2}$' docs/CONNECT.md`
  prints `claude.ai whoami: returned` (the placeholder from ticket 06 does not match). The
  reviewer checks that the email is shammai's and that Answer quotes his report.
- `docs/DECISIONS.md` records the T0 result: `grep -E '^### D[0-9]+\. T0 result' docs/DECISIONS.md`
  prints `T0 result`.

```check
# The conductor runs this block before review.
$ pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test
exit 0
$ pnpm --filter @sky-brain/server exec vitest run src/mcp/claude-flow.test.ts --reporter=verbose
prints claude.ai flow: CIMD client signs in with Perminister and whoami returns the email
$ grep -E '^- claude\.ai whoami: returned [^ @]+@[^ ]+ on 20[0-9]{2}-[0-9]{2}-[0-9]{2}$' docs/CONNECT.md
prints claude.ai whoami: returned
$ grep -E '^### D[0-9]+\. T0 result' docs/DECISIONS.md
prints T0 result
$ curl -sS -o /dev/null -w 'status %{http_code}' -X POST "$PUBLIC_URL/mcp"
prints status 401
needs network and the deployed service, with PUBLIC_URL set to its address
$ curl -fsS "$PUBLIC_URL/.well-known/oauth-protected-resource/mcp"
prints /mcp
needs network and the deployed service, with PUBLIC_URL set to its address
```

## Reference

- map.md § Destination (the bar), `docs/CONNECT.md` (new in ticket 06), `docs/layer-1/LOGIN-MCP-PLAN.md`
  "Connect the clients" and "Done when" (read-only).

## Answer

Started at commit `0cd813d1e41fc3a22cf88cffd4c97843ae7cb3e2`.

**Built**

- `docs/CONNECT.md`: `## Verified` placeholder replaced with the claude.ai line and one line each
  for the phone app, Claude Code, the account without access, cold-start timing, the steps that
  differed, and Codex CLI / DCR.
- `docs/DECISIONS.md`: new `### D18. T0 result: claude.ai connects through Better Auth; other
  clients not yet tested` (D17 was the last; 18 is the next free number).

**Proof**

1. Fresh clone: `git clone /home/user/sky-brain <scratch>/clone` at `0cd813d`, then
   `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` exit 0:
   `All matched files use Prettier code style!`; typecheck Done in `apps/web`, `packages/shared`,
   `apps/server`; `packages/shared` `Test Files 2 passed (2)`, `Tests 15 passed (15)`;
   `apps/server` `Test Files 23 passed (23)`, `Tests 301 passed (301)`.
   `pnpm --filter @sky-brain/server exec vitest run src/mcp/claude-flow.test.ts --reporter=verbose`
   exit 0:
   ```
   ✓ src/mcp/claude-flow.test.ts > claude.ai flow > claude.ai flow: CIMD client signs in with Perminister and whoami returns the email 220ms
   ✓ src/mcp/claude-flow.test.ts > claude.ai flow > claude.ai flow: a Claude Code client on any loopback port gets whoami 91ms
   Test Files  1 passed (1)
        Tests  2 passed (2)
   ```
   The same block re-run in the repo after the doc edits: exit 0, same counts (server 301, shared
   15), both claude-flow tests passed.
2. Deploy curl checks: **not run from here.** This cloud container's proxy blocks
   `*.vercel.app`: `curl -sS -X POST https://sky-brain.vercel.app/mcp` gave
   `curl: (56) CONNECT tunnel failed, response 403` (`status 000`), and the protected resource
   metadata fetch gave `curl: (22) The requested URL returned error: 403`. No output is claimed for
   these two lines; they need a run from a machine that reaches Vercel. The nearest evidence is
   shammai's report below (discovery metadata served, and claude.ai completed the OAuth flow
   against `/mcp`), which is his observation, not a run of these commands.
3. `grep -E '^- claude\.ai whoami: returned [^ @]+@[^ ]+ on 20[0-9]{2}-[0-9]{2}-[0-9]{2}$' docs/CONNECT.md`
   exit 0, prints `- claude.ai whoami: returned s…@gmail.com on 2026-11-11`.
4. `grep -E '^### D[0-9]+\. T0 result' docs/DECISIONS.md` exit 0, prints
   `### D18. T0 result: claude.ai connects through Better Auth; other clients not yet tested`.

**shammai's report** (project thread, 2026-11-11, as relayed; quoted, nothing added):

- Deployed to https://sky-brain.vercel.app from branch claude/login-mcp (commit 0cd813d,
  "chore(login-mcp): 08 follow-ups"); Vercel production branch was switched to claude/login-mcp
  for the test.
- The Perminister production app client (origin https://sky-brain.vercel.app, self sign-up
  disabled, 12 h sessions) hands its Vercel variables out as PERMINISTER_APP_CLIENT_ID /
  PERMINISTER_APP_CLIENT_SECRET (ticket 08 made the server read them). PERMINISTER_BASE_URL is
  https://www.perminister.com.
- The first claude.ai connect failed with "Couldn't register with sky-brain's sign-in service"
  because the older build was still serving production (/.well-known paths returned the web
  page). After the production redeploy, /healthz returned {"ok":true} and
  /.well-known/oauth-authorization-server/api/auth returned the metadata with
  "client_id_metadata_document_supported":true and issuer https://sky-brain.vercel.app/api/auth.
- shammai then added the custom connector in claude.ai (Name sky-brain, URL
  https://sky-brain.vercel.app/mcp, no client id or secret), signed in with Perminister, allowed
  consent, and reported "Connected to sky-brain. it work" at 2026-11-11 16:08 UTC.
- whoami through that claude.ai connector (called on 2026-11-11) returned shammai's email and one
  workspace with role owner. The repo is public, and shammai chose (decision card) to record the
  email MASKED as `s…@gmail.com` in docs/CONNECT.md.
- Not tested yet: the Claude phone app, Claude Code CLI, a Perminister account without
  sky-brain access, cold-start timing, and Codex CLI / DCR.

**Manual steps still open** (for whoever runs them; record results in `docs/CONNECT.md`
§ Verified): add the connector in the Claude phone app and call `whoami`; run
`claude mcp add --transport http sky-brain https://sky-brain.vercel.app/mcp`, then `/mcp` to sign
in and call `whoami`; sign in with a Perminister account that has no `sky-brain` access and
confirm it ends at "No access"; after the function has been idle, time the first
`/.well-known/oauth-authorization-server/api/auth` and token calls (claude.ai waits at most
10 s); try Codex CLI on the same URL and note whether it asks for DCR. From a machine that
reaches Vercel: `curl -sS -o /dev/null -w 'status %{http_code}' -X POST https://sky-brain.vercel.app/mcp`
must print `status 401`, and
`curl -fsS https://sky-brain.vercel.app/.well-known/oauth-protected-resource/mcp` must contain `/mcp`.

**Decisions**

- The email is recorded masked (`s…@gmail.com`), as shammai chose; the full address is written
  nowhere in the repo. The masked form still matches the Done when regex.
- The D18 outcome is neither of the ticket's two named outcomes: claude.ai passed, no client
  failed (so no WorkOS switch), but the phone app and Claude Code are untested, so "all passed"
  cannot be claimed. The heading says exactly that, and the decision keeps Better Auth (D7) with
  the open clients listed.
- "Steps that differed": only what the report states (stale production build caused the first
  failure until redeploy; the connector form has a Name field the doc does not mention). The
  production-branch switch is in D18, not CONNECT.md, as it was a test arrangement.

**Shortcuts taken**: none.

**For later tickets**: the deploy curl checks and the five untested clients/cases remain manual
work; a follow-up should fill the `not yet tested` lines in `docs/CONNECT.md` § Verified and, if
the phone app or Claude Code fails, add a ticket or a WorkOS decision. `docs/CONNECT.md` § 3
claude.ai could mention the connector's Name field (not changed here: outside "write only the
report" for this ticket).
