# Make the acceptance tests pass, round 2

Type: task
Status: resolved
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

    Received: "http://127.0.0.1:41185/api/auth/error?error=state_not_found"
    
     ❯ refused.test.ts:184:28
        182|     const sessionsBefore = await sessionCount(ctx.db);
        183|     const res = await b.request(`/api/auth/callback/perminister?code=$…
        184|     expect(res.next ?? "").toContain("error=state_mismatch");
           |                            ^
        185|     await expectNoSession(server, b, sessionsBefore);
        186|   });
    
    ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[21/24]⎯
    
     FAIL  sign-in.test.ts > two people stay walled off > two people with access each see exactly their own workspace in whoami, with different ids
    AssertionError: expected false to be true // Object.is equality
    
    - Expected
    + Received
    
    - true
    + false
    
     ❯ getCode helpers.ts:314:50
        312|     redirect = pathOf(server, consent.next);
        313|   }
        314|   expect(redirect.startsWith(redirectUri + "?")).toBe(true);
           |                                                  ^
        315|   const params = new URL(redirect).searchParams;
        316|   expect(params.get("state")).toBe(state);
     ❯ connect helpers.ts:351:13
     ❯ sign-in.test.ts:155:41
    
    ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[22/24]⎯
    
     FAIL  sign-in.test.ts > invites are accepted at sign-in > whoami lists the own workspace and the invited one, with the invite's role, and no other
    AssertionError: expected false to be true // Object.is equality
    
    - Expected
    + Received
    
    - true
    + false
    
     ❯ getCode helpers.ts:314:50
        312|     redirect = pathOf(server, consent.next);
        313|   }
        314|   expect(redirect.startsWith(redirectUri + "?")).toBe(true);
           |                                                  ^
        315|   const params = new URL(redirect).searchParams;
        316|   expect(params.get("state")).toBe(state);
     ❯ connect helpers.ts:351:13
     ❯ sign-in.test.ts:223:50
    
    ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[23/24]⎯
    
    
     Test Files  5 failed | 1 passed (6)
          Tests  24 failed | 59 passed (83)
       Start at  16:33:06
       Duration  7.44s (tests 82%, import 17%, transform 1%)

## Answer

Work started at c7d18928e0bb0ad4c322f64440517097839c839b.

**Built**
- `apps/server/src/testing/navigate.ts` (new): a GET over `node:http` that sends
  `Sec-Fetch-Mode: navigate`. Node's fetch (undici) always sends `Sec-Fetch-Mode: cors` and
  overwrites any value a caller sets, so Better Auth's oauth provider took every harness request
  for a page script's fetch: the Perminister callback that resumes an OAuth authorization answered
  `302 Location: /` with a body `{redirect: true, url: "/consent?..."}`, and `next` was `/`. A real
  browser's navigation gets `302 Location: /consent?...` (as in shammai's claude.ai connect).
- `apps/server/src/testing/auth-harness.ts`: `Browser.request` sends a body-less GET through
  `navigate` (a link or redirect), everything else through fetch as before (the page scripts).
- `apps/server/src/auth/routes.ts`: `GET /api/auth/callback/perminister` with no or an empty
  `state` redirects 302 to `/api/auth/error?error=state_mismatch` before Better Auth, which would
  answer `state_not_found` (spec.md Edge cases: "forged or missing `state`" gives `state_mismatch`).
- `apps/server/src/config.ts`: the two client errors end with `(or the older PERMINISTER_CLIENT_ID)`
  / `(or the older PERMINISTER_CLIENT_SECRET)`. They still start with ticket 08's
  `PERMINISTER_APP_CLIENT_* must be set when NODE_ENV is production; refusing to start`, and now
  also name spec.md's names, which the four acceptance config tests ask for.
- `apps/server/src/auth/access.test.ts`: a callback with no state and with `state=` ends at
  `error=state_mismatch` with no session and no user (refused case; the forged-state case beside it
  already existed).
- `apps/server/src/config.test.ts`: the refused-production test also checks the fallback name.
- `docs/CONNECT.md`: the troubleshooting example quotes the full new message.

**Proof**
- `pnpm exec vitest run --root plans/login-mcp/acceptance`: `Test Files 6 passed (6)`,
  `Tests 83 passed (83)`, exit 0 (before: 24 failed). No test was ruled wrong; no Ask.
- `pnpm test`: shared `15 passed`, server `Test Files 23 passed (23)`, `Tests 301 passed (301)`,
  exit 0. Also `pnpm lint` exit 0, `pnpm typecheck` exit 0, and ticket 08's greps still print
  `errors-ok` and `trouble-ok`.

**Decisions**
- Fixed the harness, not the server, for the consent redirect: production already answers a
  navigation with the right 302 (claude.ai connect worked on 2026-11-11); the harness could not
  send what a browser sends. spec.md says the harness plays the browser and that step 3's `next` is
  `/consent?...`.
- Config errors name both names rather than going back to the old ones: ticket 08 (approved by
  shammai) keeps `PERMINISTER_APP_CLIENT_*` first; spec.md line 211 still names the old names and
  was never updated for 08. Naming both satisfies both.

**Shortcuts taken**
- The missing-state guard covers GET only (Perminister calls back with GET). A form_post callback
  without state would still get Better Auth's `state_not_found`, also with no session.

**For later tickets**
- spec.md (Settings, line 211 edge case) still names only `PERMINISTER_CLIENT_ID` /
  `PERMINISTER_CLIENT_SECRET`; a human should bring it in line with ticket 08.
- Harness GETs are navigations now: a callback that resumes an OAuth flow answers a real 302 with
  no JSON body. Existing tests that read `body.url` first still fall back to `next`.
- Step 5's claim (`Status: claimed`) was not saved before the code changes in this run; the ticket
  went from open to resolved.
