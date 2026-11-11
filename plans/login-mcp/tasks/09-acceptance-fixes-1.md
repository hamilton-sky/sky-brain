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
