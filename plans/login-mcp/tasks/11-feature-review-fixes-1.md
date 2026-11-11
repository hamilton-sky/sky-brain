# Fix the findings of the feature review, round 1

Type: task
Status: open
Blocked by: —
Test first: no
Level: 2
Check: none the feature review that follows checks these fixes

The review of the whole feature (from commit 192ebae3a05893808eed80da515c61362e8a09de) failed. Fix each finding below that is a blocker or a major, in the files it names. A minor is optional. If a finding is wrong, say why in the Answer instead.

## Not in this ticket

- Anything the findings do not name.

## Done when

- Every blocker and major finding below is fixed, or the Answer says why it stays.
- commands.md's Test command passes.

## Findings

> FEATURE
> - tickets met: 07 bullets 1 and 4 | NOT VERIFIED: 07 bullet 2 (the deploy answers the /mcp challenge) and the reviewer half of bullet 3 (the email is shammai's)
>
> What I ran myself:
> - Fresh clone of HEAD aee9fa4 into /tmp/claude-0/-home-user/f7db0c69-e60e-546c-971c-9768295fd158/scratchpad/clone: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` exited 0 (server 301 tests, shared 15).
> - `vitest run src/mcp/claude-flow.test.ts --reporter=verbose` printed "claude.ai flow: CIMD client signs in with Perminister and whoami returns the email", and both tests passed.
> - The Acceptance command `pnpm exec vitest run --root plans/login-mcp/acceptance` passed 83 of 83.
> - Both greps match: `- claude.ai whoami: returned s…@gmail.com on 2026-11-11` and `### D18. T0 result: ...`.
> - Both deploy curls failed here: the proxy answers CONNECT 403 for *.vercel.app.
>
> The conductor's note says every Done when check passed at HEAD. That is not true for the two curls: plans/login-mcp/followups.md records them as deferred, with exit 3.
>
> I did not read any ticket's Answer.
>
> 1. major docs/CONNECT.md / deploy (ticket 07): Done when bullet 2 has not been checked by anyone against the committed code. The two curls have only ever been deferred. D18 says production ran commit 0cd813d, but HEAD has since changed apps/server/src/auth/routes.ts and config.ts. The /mcp route and the metadata code are the same as at 0cd813d, and claude.ai connecting is indirect evidence that they work, but the bullet itself is unproven.
>    - Fix: deploy HEAD. Then have shammai (or any machine outside this container) run `curl -sS -o /dev/null -w 'status %{http_code}' -X POST https://sky-brain.vercel.app/mcp` (expect `status 401`) and `curl -fsS https://sky-brain.vercel.app/.well-known/oauth-protected-resource/mcp` (expect `/mcp` in the output).
>    - Record the output in the ticket and remove the repeated deferred entries from followups.md.
>
> 2. major docs/CONNECT.md (ticket 07): the Verified line records a masked email, `s…@gmail.com`. The ticket asks for `<the email whoami returned>`, and Done when says the reviewer checks that the email is shammai's. A masked value passes the grep only because `…` counts as a non-space character, and nobody can check it.
>    - Open question for shammai: record the full email, or accept the masked form for privacy?
>    - If he accepts the mask, add a note under Verified that the address is masked on purpose and that shammai confirmed it.
>
> 3. minor docs/DECISIONS.md D18 (ticket 07): "Chosen: Better Auth stays" is neither outcome the ticket allows. The ticket offers two: keep Better Auth because claude.ai, the phone app and Claude Code all passed, or switch to WorkOS. Only claude.ai was tried.
>    - Open question for shammai: does Better Auth stay provisionally until the phone app and Claude Code are tried, or does T0 stay open? Either way, record the final result as a new D entry later. DECISIONS.md is append-only, so D18 cannot be changed.
>    - Ticket step 2 also asked for the phone app, Claude Code CLI, an account without access and cold-start timing. All are "not yet tested". Give that work an owner (a follow-up ticket) so it is not lost.
>
> 4. minor docs/PLAN.md (ticket 07): PLAN.md says "Production deploys from `main`", but D18 says Vercel's production branch was switched to `claude/login-mcp` for the test.
>    - Fix: switch it back once this is merged, or note the temporary state in CONNECT.md § Verified.
>
> 5. minor apps/server/src/config.ts (tickets 08/10): the production error now reads "PERMINISTER_APP_CLIENT_ID must be set when NODE_ENV is production; refusing to start (or the older PERMINISTER_CLIENT_ID)". The hint comes after "refusing to start", so it reads oddly.
>    - Fix: put the hint straight after the variable name, as in "PERMINISTER_APP_CLIENT_ID (or the older PERMINISTER_CLIENT_ID) must be set ...". Keep the acceptance test's match on both names, and update the example in CONNECT.md.
>
> Left behind: the fresh clone with its node_modules at /tmp/claude-0/-home-user/f7db0c69-e60e-546c-971c-9768295fd158/scratchpad/clone, plus fresh.log and flow.log in the same scratchpad.
>
> REVIEW: FAIL

## Answer

**Built**
- `apps/server/src/config.ts`: `fail` takes one message; the client id and secret errors now read
  `PERMINISTER_APP_CLIENT_ID (or the older PERMINISTER_CLIENT_ID) must be set when NODE_ENV is production; refusing to start` (and the same for the secret).
- `apps/server/src/config.test.ts`: the production test matches the whole new message (both
  names, anchored at both ends) instead of a prefix plus a `toContain`.
- `docs/CONNECT.md`: Troubleshooting example updated; § Verified gains the masked-email note, the
  deploy check results, the temporary production-branch note and the owner of the untested items.
- `docs/DECISIONS.md`: new D19 (D18 untouched, the file is append-only).
- `plans/login-mcp/followups.md`: the four repeated `07-prove-the-bar` deferred-curl sections
  removed; a `11-feature-review-fixes-1` section added with the T0 client follow-up (owner
  shammai) and the production-branch switch back.

**Proof**
- Finding 1 (major, deploy): fixed with shammai's input (2026-11-11 18:15 UTC). He ran both curls
  from his own machine against https://sky-brain.vercel.app, production built from the latest
  `claude/login-mcp` push (this container cannot reach `*.vercel.app`, learnings 07):
  ```
  $ curl -sS -o /dev/null -w 'status %{http_code}' -X POST https://sky-brain.vercel.app/mcp
  status 401
  $ curl -fsS https://sky-brain.vercel.app/.well-known/oauth-protected-resource/mcp
  {"resource":"https://sky-brain.vercel.app/mcp","authorization_servers":["https://sky-brain.vercel.app/api/auth"],"bearer_methods_supported":["header"],"dpop_signing_alg_values_supported":["EdDSA","ES256","ES512","PS256","RS256"],"scopes_supported":["brain:read","brain:write"]}
  ```
  Both match ticket 07 bullet 2 (`status 401`; `/mcp` in the output). Recorded in CONNECT.md
  § Verified and D19; the deferred entries are gone from followups.md (`grep -c 07-prove
  followups.md` prints 0). I did not run these curls myself; the output is shammai's.
- Finding 2 (major, masked email): shammai chose the masked form `s…@gmail.com` on a decision card
  (the repo is public) and confirmed the address is his. CONNECT.md § Verified now says the mask is
  on purpose and that shammai confirmed it. The full address is written nowhere (a grep of the diff
  for `<chars>@gmail` finds nothing).
- Finding 3 (minor): shammai has not answered yet. D19 records Better Auth as staying
  provisionally, pending his answer; the untested clients (phone app, Claude Code CLI, account
  without access, cold start, Codex/DCR) have an owner, shammai, in followups.md and CONNECT.md.
- Finding 4 (minor): took the second option, a note in CONNECT.md § Verified that Vercel's
  production branch is `claude/login-mcp` for the test and must go back to `main` after the merge
  (also a followups.md item). PLAN.md is unchanged, since `main` is still the intended state.
- Finding 5 (minor): fixed as above. `vitest run src/config.test.ts`: 16 passed.
- `pnpm test` (commands.md Test): exit 0, server 301 passed (23 files), shared 15 passed.
  `pnpm lint` exit 0, `pnpm typecheck` exit 0, Acceptance 83 of 83 passed.

**Decisions**
- The untested T0 clients get their owner through a followups.md entry and D19, not a new ticket
  file: creating tickets is the planner's job and would reopen the feature.
- D19 "Qualifies" D18 rather than "Supersedes" it, since the outcome is not final.

**Shortcuts taken:** none.

**Review fixes:** all five findings handled as in Proof. None judged wrong.

**For later tickets**
- When shammai answers on Better Auth or the other clients are tried, add a new D entry (D20);
  do not edit D18 or D19. Switch Vercel's production branch back to `main` after the merge and
  drop the note in CONNECT.md § Verified.

## Review findings (round 1, floor guard)

warning: 1 assertion line(s) removed, 0 added. check that no test got weaker.
floor guard: the diff weakens the bar instead of meeting it
ticket-edit: plans/login-mcp/followups.md: only your own ticket, map.md and learnings.md may change
if a finding is intended, the ticket needs a line like: Floor: allow <category>
