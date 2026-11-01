# Add the auth settings to render.yaml, record the Render decision and write docs/CONNECT.md

Type: task
Status: open
Blocked by: 01, 05
Test first: no
Level: 3
Touches: render.yaml, docs/CONNECT.md, docs/DECISIONS.md, docs/PLAN.md, docs/layer-1/LOGIN-MCP-PLAN.md

Make the deploy carry what the server now refuses to start without in production (ticket 02),
and write down how each client connects.

**`render.yaml`.** Add to the web service's `envVars`, keeping `NODE_ENV` and `DATABASE_URL` as they
are: `BETTER_AUTH_SECRET` with `generateValue: true`; `PUBLIC_URL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `BOOTSTRAP_OWNER_EMAIL` and `ALLOWED_EMAILS` with `sync: false` (map.md: Render asks for them
only when the Blueprint is first created and ignores them on later Blueprint updates). Plans: as ticket 01's
Answer says. With A, leave `plan:` lines as they are. With B, keep this file paid as the real
deploy and describe the free spike in the new `docs/CONNECT.md` (free web and Postgres, migration in the
start command, the keep-alive ping from LOGIN-MCP-PLAN step 4); do not commit a second Blueprint
unless ticket 01's Answer asks for one.

**`docs/DECISIONS.md`.** `### D17. Render plan: <paid or free spike>` (login-mcp owns D16 to
D18; D16 is ticket 03's) recording ticket 01's answer, with the
facts it rests on (sleep after 15 minutes and about a minute to wake versus claude.ai's 10-second
OAuth wait; free Postgres deleted after 30 days with no backups) and the rejected option.

**`docs/CONNECT.md`** (new file; T9 asks for it, and the brief puts it in scope). Exact steps, from
LOGIN-MCP-PLAN "Deploy" and "Connect the clients", corrected to what was built:
- The Google OAuth client: Web application, authorized origin `<PUBLIC_URL>`, redirect URI
  `<PUBLIC_URL>/api/auth/callback/google` (and `http://127.0.0.1:3000/api/auth/callback/google` for
  local work); keep the ID and secret out of the repo and out of chat; while the app is in Testing
  mode only listed test users can sign in, so add every `ALLOWED_EMAILS` person as a test user
  (map.md source line).
- Render: New → Blueprint → this repo; the five `sync: false` values. If the Blueprint already
  exists (brain-core deployed it), Render will not ask: add the five by hand under the service's
  Environment tab. Then check
  `<PUBLIC_URL>/healthz` and that `<PUBLIC_URL>/.well-known/oauth-protected-resource/mcp` shows
  `resource` `<PUBLIC_URL>/mcp`.
- claude.ai: Settings → Connectors → Add custom connector, URL `<PUBLIC_URL>/mcp`, no client ID or
  secret, sign in with Google, Allow, then ask Claude to call `whoami`. The phone app shows the same
  connector.
- Claude Code: `claude mcp add --transport http sky-brain <PUBLIC_URL>/mcp`, then `/mcp` to sign in.
  Cloud sessions: add the host to the environment's allowed domains.
- Codex CLI: try the same URL and write down whether it needs DCR (off; turning it on is a
  separate decision).
- Troubleshooting: `curl -i -X POST <PUBLIC_URL>/mcp` must show 401 and the `resource_metadata`
  header; "No access" means the email is neither `BOOTSTRAP_OWNER_EMAIL` nor in `ALLOWED_EMAILS`
  (an invite alone does not let anyone in; add the email to the list, then the invite is accepted at
  their next sign-in). Each person gets their own workspace at first sign-in.
- A `## Verified` section for ticket 07 holding exactly the placeholder line
  `- claude.ai whoami: not yet verified`.

**`docs/PLAN.md`** section 12: the settings list matches `render.yaml`, and the plan line matches
ticket 01's answer. **`docs/layer-1/LOGIN-MCP-PLAN.md`**: one line under its title saying steps 3 to
8 are built by `plans/login-mcp`, that its free-tier sketch and "D13" are superseded by the decision
above, and that the resource metadata URL is the path form
`/.well-known/oauth-protected-resource/mcp` (both paths answer).

## Not in this ticket

- Deploying and the manual client checks: ticket 07.
- The keep-alive GitHub Actions cron: only with ticket 01's answer B, and then as its own
  follow-up, because it touches `.github/workflows/`.

## Done when

- `render.yaml` lists the six auth settings: `grep -cE 'key: (BETTER_AUTH_SECRET|PUBLIC_URL|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|BOOTSTRAP_OWNER_EMAIL|ALLOWED_EMAILS)$' render.yaml` prints `6`.
- `BETTER_AUTH_SECRET` is generated, not typed: `grep -A1 'key: BETTER_AUTH_SECRET' render.yaml` prints `generateValue: true`.
- The new `docs/CONNECT.md` exists and names the Google redirect path:
  `grep -q '/api/auth/callback/google' docs/CONNECT.md && echo connect-ok` prints `connect-ok`.
- The Verified placeholder is there and not yet filled:
  `grep -c '^- claude.ai whoami: not yet verified$' docs/CONNECT.md` prints `1`.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ grep -cE 'key: (BETTER_AUTH_SECRET|PUBLIC_URL|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|BOOTSTRAP_OWNER_EMAIL|ALLOWED_EMAILS)$' render.yaml
prints 6
$ grep -A1 'key: BETTER_AUTH_SECRET' render.yaml
prints generateValue: true
$ grep -q '/api/auth/callback/google' docs/CONNECT.md && echo connect-ok
prints connect-ok
$ grep -c '^- claude.ai whoami: not yet verified$' docs/CONNECT.md
prints 1
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Interfaces (Settings), § Risks; ticket 01's Answer.
- `render.yaml`, `docs/PLAN.md` section 12, `docs/layer-1/LOGIN-MCP-PLAN.md`, `docs/layer-1/TICKETS.md` (T9).

## Answer
