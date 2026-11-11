# Make the acceptance tests pass, round 2

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
