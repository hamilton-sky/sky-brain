# List the Vercel environment variables and write docs/CONNECT.md

Type: task
Status: open
Blocked by: 01, 05
Test first: no
Level: 3
Builder: docs
Touches: docs/CONNECT.md (new), docs/PLAN.md, docs/layer-1/LOGIN-MCP-PLAN.md

Shrunk by the repair (shammai, 2026-11-09): hosting is Vercel + Nanogres (D16, ticket 01), so
there is no `render.yaml` and no hosting decision to write. What is left is to say exactly which
settings shammai types into Vercel's dashboard, and how each client connects. Nothing in code
changes here; ticket 02 already made the server refuse a production start without the settings.

**The environment variables** (Vercel → Project → Settings → Environment Variables, entered by
shammai by hand, Production scope; never committed, never pasted into chat or logs):

| Variable | Value |
|---|---|
| `PUBLIC_URL` | `https://sky-brain.vercel.app` |
| `BETTER_AUTH_SECRET` | a new random value of at least 32 characters (`openssl rand -base64 32`) |
| `DATABASE_URL` | Nanogres app role, PgBouncer port 6432 (already set by D16) |
| `MIGRATION_DATABASE_URL` | Nanogres migrate role, port 6433 (already set by D16) |
| `MIGRATION_DATABASE_ROLE` | the owner role from the migrate role's Nanogres snippet (already set by D16) |
| `PERMINISTER_BASE_URL` | Perminister's base URL, `https://`, no trailing slash |
| `PERMINISTER_CLIENT_ID` | the production app client's id |
| `PERMINISTER_CLIENT_SECRET` | the production app client's secret (shown once by Perminister) |

**`docs/PLAN.md`** section 12: the bullet "The auth settings from login-mcp: `PUBLIC_URL`,
`BETTER_AUTH_SECRET` and the sign-in client's id and secret" becomes the five auth variables by
name (`PUBLIC_URL`, `BETTER_AUTH_SECRET`, `PERMINISTER_BASE_URL`, `PERMINISTER_CLIENT_ID`,
`PERMINISTER_CLIENT_SECRET`) with a pointer to the new `docs/CONNECT.md`.

**`docs/CONNECT.md`** (new file; T9 asks for it, and the brief puts it in scope). Exact steps,
from LOGIN-MCP-PLAN "Deploy" and "Connect the clients", corrected to what was built:
- **Perminister app client.** In Perminister, product `sky-brain` in the `hamilton-sky`
  organization (`e3541747-bfab-4fd0-b900-809aa29a099c`), App clients: create the production
  client with app origin `https://sky-brain.vercel.app` and self-registration off; the callback
  path is fixed at `/auth/perminister/callback`. Copy its id and secret straight into Vercel (the
  secret is shown once). For local work the existing client
  `10e163a2-1cfe-408d-a6f5-968aa7f46923` has origin `http://localhost`, which accepts any
  localhost port, so `pnpm dev` with `PUBLIC_URL` unset (it defaults to `http://localhost:<PORT>`)
  and the three `PERMINISTER_*` settings in a local `.env` (ignored by git) works. Who may sign in
  is whoever Perminister has given access to the `sky-brain` product: invite people there.
- **Vercel.** The table above, then redeploy. Check `https://sky-brain.vercel.app/healthz` and that
  `https://sky-brain.vercel.app/.well-known/oauth-protected-resource/mcp` shows `resource`
  `https://sky-brain.vercel.app/mcp`. Preview deployments share the settings but sign-in works only
  on the production URL (the Perminister client and `PUBLIC_URL` name it).
- **claude.ai**: Settings → Connectors → Add custom connector, URL
  `https://sky-brain.vercel.app/mcp`, no client ID or secret, sign in with Perminister, Allow,
  then ask Claude to call `whoami`. The phone app shows the same connector.
- **Claude Code**: `claude mcp add --transport http sky-brain https://sky-brain.vercel.app/mcp`,
  then `/mcp` to sign in. Cloud sessions: add the host to the environment's allowed domains.
- **Codex CLI**: try the same URL and write down whether it needs DCR (off; turning it on is a
  separate decision).
- **Troubleshooting**: `curl -i -X POST https://sky-brain.vercel.app/mcp` must show 401 and the
  `resource_metadata` header; "No access" means Perminister signed the person in but has not given
  them access to `sky-brain` (or the account has no email): add them there, then a sky-brain
  invite is accepted at their next sign-in. Each person gets their own workspace at first sign-in.
  A function that will not start names the missing setting in Vercel's logs.
- A `## Verified` section for ticket 07 holding exactly the placeholder line
  `- claude.ai whoami: not yet verified`.

**`docs/layer-1/LOGIN-MCP-PLAN.md`**: one line under its title saying steps 3 to 8 are built by
`plans/login-mcp`, that sign-in is Perminister (not Google), that hosting is Vercel + Nanogres
(D16, superseding its Render sketch and "D13"), and that the resource metadata URL is the path
form `/.well-known/oauth-protected-resource/mcp` (both paths answer).

## Not in this ticket

- `render.yaml`: removed by D16; nothing to write.
- A hosting decision in `docs/DECISIONS.md`: D16 is it (ticket 01 records the answer).
- Setting the variables in Vercel and registering the Perminister client: shammai, following
  the new `docs/CONNECT.md`; deploying and the manual client checks: ticket 07.
- `vercel.json` and `api/index.mjs`: unchanged; every route this feature adds is under an existing
  rewrite.

## Done when

- The new `docs/CONNECT.md` names every Vercel variable:
  `grep -oE 'PUBLIC_URL|BETTER_AUTH_SECRET|DATABASE_URL|MIGRATION_DATABASE_URL|MIGRATION_DATABASE_ROLE|PERMINISTER_BASE_URL|PERMINISTER_CLIENT_ID|PERMINISTER_CLIENT_SECRET' docs/CONNECT.md | sort -u | wc -l`
  prints `8`.
- It names the Perminister callback path and the production origin:
  `grep -q '/auth/perminister/callback' docs/CONNECT.md && grep -q 'https://sky-brain.vercel.app' docs/CONNECT.md && echo connect-ok`
  prints `connect-ok`.
- The Verified placeholder is there and not yet filled:
  `grep -c '^- claude.ai whoami: not yet verified$' docs/CONNECT.md` prints `1`.
- `docs/PLAN.md` names the Perminister settings:
  `grep -q 'PERMINISTER_CLIENT_SECRET' docs/PLAN.md && echo plan-ok` prints `plan-ok`.
- No secret value is written down:
  `grep -cE 'PERMINISTER_CLIENT_SECRET *= *[^ <]' docs/CONNECT.md || true` prints `0`.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ grep -oE 'PUBLIC_URL|BETTER_AUTH_SECRET|DATABASE_URL|MIGRATION_DATABASE_URL|MIGRATION_DATABASE_ROLE|PERMINISTER_BASE_URL|PERMINISTER_CLIENT_ID|PERMINISTER_CLIENT_SECRET' docs/CONNECT.md | sort -u | wc -l
prints 8
$ grep -q '/auth/perminister/callback' docs/CONNECT.md && grep -q 'https://sky-brain.vercel.app' docs/CONNECT.md && echo connect-ok
prints connect-ok
$ grep -c '^- claude.ai whoami: not yet verified$' docs/CONNECT.md
prints 1
$ grep -q 'PERMINISTER_CLIENT_SECRET' docs/PLAN.md && echo plan-ok
prints plan-ok
$ grep -cE 'PERMINISTER_CLIENT_SECRET *= *[^ <]' docs/CONNECT.md || true
prints 0
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Interfaces (Settings, Perminister calls), § Risks; ticket 01's Answer; map.md repair
  lines (Perminister API, known values).
- `docs/DECISIONS.md` D16, `docs/PLAN.md` section 12, `vercel.json`,
  `docs/layer-1/LOGIN-MCP-PLAN.md`, `docs/layer-1/TICKETS.md` (T9).

## Answer
