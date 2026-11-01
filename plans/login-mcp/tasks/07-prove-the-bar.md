# Prove the bar on a fresh clone and after deploy, and record what worked

Type: task
Status: open
Blocked by: 05, 06
Test first: no
Level: 1
Builder: docs
Touches: docs/CONNECT.md, docs/DECISIONS.md

The acceptance ticket: both halves of map.md's bar, against what is committed.

1. Clone the committed `HEAD` into a temporary folder and run
   `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` there; then
   `pnpm --filter @sky-brain/server exec vitest run src/mcp/claude-flow.test.ts --reporter=verbose`.
   Paste the summary lines under Answer → Proof.
2. The manual half needs shammai (his Google client and Render account; LOGIN-MCP-PLAN "Needs
   from you"): deploy with the Blueprint as `docs/CONNECT.md` (new in ticket 06) says, then add the connector in
   claude.ai and ask for `whoami`. It must return shammai's email. Also try the phone app and
   Claude Code CLI, and a Google account that is not in `ALLOWED_EMAILS` (it must end at "No access"). The builder
   cannot do this alone: write the steps and what to look for under Answer, and fill in the
   results shammai reports.
3. In the `## Verified` section of `docs/CONNECT.md` (new in ticket 06), replace the placeholder
   with `- claude.ai whoami: returned <the email whoami returned> on <YYYY-MM-DD>`, then add one
   line each for the phone app, Claude Code, the account not on the list, the steps that differed from
   the doc, and whether Codex CLI needed DCR. Write only what shammai reports; never fill the
   claude.ai line before he has seen it.
4. `docs/DECISIONS.md`: a decision headed `### D18. T0 result: <outcome>` (login-mcp owns D16 to
   D18) recording the T0 result and the auth setup it tested (Better Auth 1.7.15 with
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
- `docs/DECISIONS.md` records the T0 result: `grep -E '^### D18\. T0 result' docs/DECISIONS.md`
  prints `T0 result`.

```check
# The conductor runs this block before review.
$ pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test
exit 0
$ pnpm --filter @sky-brain/server exec vitest run src/mcp/claude-flow.test.ts --reporter=verbose
prints claude.ai flow: CIMD client signs in with Google and whoami returns the email
$ grep -E '^- claude\.ai whoami: returned [^ @]+@[^ ]+ on 20[0-9]{2}-[0-9]{2}-[0-9]{2}$' docs/CONNECT.md
prints claude.ai whoami: returned
$ grep -E '^### D18\. T0 result' docs/DECISIONS.md
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
