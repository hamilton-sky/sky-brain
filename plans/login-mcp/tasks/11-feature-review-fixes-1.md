# Fix the findings of the feature review, round 1

Type: task
Status: resolved
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

Started at commit `ad88c139bf3e51a37f2ff327b5453a383d7be81a`.

**Built**

- `docs/CONNECT.md` § Verified: a note under the claude.ai line that the address is masked on
  purpose and that shammai confirmed it is his; an owner line (shammai) for the untested items;
  the deploy-check result; a note that Vercel's production branch is temporarily
  `claude/login-mcp`, not `main`. § Troubleshooting: the error example uses the new wording.
- `docs/DECISIONS.md`: new `### D19. Better Auth stays, provisionally, until the phone app and
  Claude Code are tried` (D18 untouched), with the open items owned by shammai and the deploy check.
- `apps/server/src/config.ts`: the client id/secret production errors now read
  `PERMINISTER_APP_CLIENT_ID (or the older PERMINISTER_CLIENT_ID) must be set when NODE_ENV is
  production; refusing to start`; `fail` lost its now unused `hint` parameter.
- `apps/server/src/config.test.ts`: the refusal test matches the whole new message (both names).
- `plans/login-mcp/followups.md`: the four repeated deferred `07-prove-the-bar` curl entries removed
  (finding 1 asks for this; the checks are now proven).

**Proof**

- Finding 1 (major): shammai's report, 2026-11-11, after the latest push of `claude/login-mcp` was
  deployed to production, run from his own machine, verbatim:
  ```
  $ curl -sS -o /dev/null -w 'status %{http_code}' -X POST https://sky-brain.vercel.app/mcp
  status 401
  $ curl -fsS https://sky-brain.vercel.app/.well-known/oauth-protected-resource/mcp
  {"resource":"https://sky-brain.vercel.app/mcp","authorization_servers":["https://sky-brain.vercel.app/api/auth"],"bearer_methods_supported":["header"],"dpop_signing_alg_values_supported":["EdDSA","ES256","ES512","PS256","RS256"],"scopes_supported":["brain:read","brain:write"]}
  ```
  `status 401` and the metadata names `/mcp`: ticket 07's bullet 2 holds. This container still
  cannot reach `*.vercel.app` (learnings 07), so I did not run them myself. The local tracking ref
  `origin/claude/login-mcp` is 439db5f; `git diff --stat 439db5f ad88c13 -- apps api vercel.json
  packages` is empty, so the deployed server code is HEAD's (before this ticket's message change).
- Finding 2 (major): shammai chose the masked form `s…@gmail.com` (public repo) and confirmed it
  is his address; the note is in CONNECT.md § Verified. The Done when grep of ticket 07 still prints
  `120:- claude.ai whoami: returned s…@gmail.com on 2026-11-11` (the note is on its own line).
- Finding 3 (minor): D19 added; `grep -nE '^### D[0-9]+\.' docs/DECISIONS.md | tail -2` prints D18
  and D19. Owner of the untested items: shammai, in D19 and CONNECT.md.
- Finding 4 (minor): temporary production-branch note in CONNECT.md § Verified (the finding's
  second option); PLAN.md unchanged, since `main` stays the intended state.
- Finding 5 (minor): `pnpm --filter @sky-brain/server exec vitest run src/config.test.ts`:
  `Tests 16 passed (16)`. Acceptance `pnpm exec vitest run --root plans/login-mcp/acceptance`:
  `Tests 83 passed (83)` (it matches the names only). `pnpm lint` exit 0, `pnpm typecheck` exit 0.
- commands.md's Test command: left to the conductor's gate.

**Decisions**

- The owner for the untested items is shammai (they need his accounts and devices), named in D19
  and CONNECT.md. I did not add a new ticket file: a builder may not add or edit other tickets, and
  this is manual work, not code. If the flow wants a ticket for it, the planner adds one.
- The deploy check is recorded in CONNECT.md and D19 (not in ticket 07, which I may not edit).
- No commit hash is given for the deploy: shammai said "the latest push", and I cannot see Vercel.

**Shortcuts taken**: none.

**For later tickets**: when `claude/login-mcp` is merged, switch Vercel's production branch back to
`main` and drop the "Temporary" line in CONNECT.md § Verified. The final T0 outcome is a new D entry
after D19.
