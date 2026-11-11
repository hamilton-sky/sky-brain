# Connect to sky-brain

How to set up sign-in for the production deploy at `https://sky-brain.vercel.app`, and how
each client connects to its MCP endpoint, `https://sky-brain.vercel.app/mcp`.

Hosting is Vercel + Nanogres (`docs/DECISIONS.md` D16). People sign in with Perminister.
Anyone Perminister has given access to the `sky-brain` product gets in; everyone else sees
"No access". Each person gets their own workspace at first sign-in.

## 1. Register the Perminister app client

1. In Perminister, open the `hamilton-sky` organization
   (`e3541747-bfab-4fd0-b900-809aa29a099c`), product `sky-brain`, App clients.
2. Create the production client with app origin `https://sky-brain.vercel.app` and
   self-registration off. The callback path is fixed at `/auth/perminister/callback`, so
   Perminister sends people back to `https://sky-brain.vercel.app/auth/perminister/callback`.
3. Copy the client's id and secret straight into Vercel (section 2). Perminister hands them
   out already named `PERMINISTER_APP_CLIENT_ID` and `PERMINISTER_APP_CLIENT_SECRET`, and shows the
   secret once. Never paste it into the repo, a chat or a log.

To let someone in, give them access to the `sky-brain` product in Perminister. A sky-brain
invite for their email is accepted at their next sign-in.

## 2. Set the Vercel environment variables

Set these in Vercel → Project → Settings → Environment Variables, Production scope, by hand.
They are never committed.

| Variable                        | Value                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `PUBLIC_URL`                    | `https://sky-brain.vercel.app`                                                |
| `BETTER_AUTH_SECRET`            | a new random value of at least 32 characters (`openssl rand -base64 32`)      |
| `DATABASE_URL`                  | Nanogres app role, PgBouncer port 6432 (already set by D16)                   |
| `MIGRATION_DATABASE_URL`        | Nanogres migrate role, port 6433 (already set by D16); used only by the build |
| `MIGRATION_DATABASE_ROLE`       | the owner role from the migrate role's Nanogres snippet (already set by D16)  |
| `PERMINISTER_BASE_URL`          | Perminister's base URL: `https://`, no path, no trailing slash                |
| `PERMINISTER_APP_CLIENT_ID`     | the production app client's id (section 1)                                    |
| `PERMINISTER_APP_CLIENT_SECRET` | the production app client's secret (section 1; shown once by Perminister)     |

Perminister hands out the client's id and secret under these two names. The older
`PERMINISTER_CLIENT_ID` / `PERMINISTER_CLIENT_SECRET` still work as a fallback; when both are set,
the `PERMINISTER_APP_` names win.

`PUBLIC_URL` and `PERMINISTER_BASE_URL` must be `https://` origins with no path or trailing
slash. In production the server refuses to start without any of the five auth variables, and
the error names the first one that is missing or wrong.

Then redeploy, and check:

- `https://sky-brain.vercel.app/healthz` answers 200.
- `https://sky-brain.vercel.app/.well-known/oauth-protected-resource/mcp` shows `resource`
  `https://sky-brain.vercel.app/mcp`. The bare `/.well-known/oauth-protected-resource` answers
  the same.

Preview deployments share the settings, but sign-in works only on the production URL: the
Perminister client and `PUBLIC_URL` both name it.

## 3. Connect the clients

### claude.ai

1. Settings → Connectors → Add custom connector.
2. URL `https://sky-brain.vercel.app/mcp`. Leave the client ID and secret empty.
3. Connect, sign in with Perminister, then Allow on the consent page.
4. In a chat, ask Claude to call `whoami`. It answers with your email and workspaces.

The Claude phone app shows the same connector.

### Claude Code

```sh
claude mcp add --transport http sky-brain https://sky-brain.vercel.app/mcp
```

Then run `/mcp` inside Claude Code, pick sky-brain and sign in.

Cloud sessions: add `sky-brain.vercel.app` to the environment's allowed domains first.

### Codex CLI

Try the same URL, `https://sky-brain.vercel.app/mcp`. Write down whether it needs Dynamic
Client Registration (DCR). DCR is off; turning it on is a separate decision.

## Local development

The existing local client `10e163a2-1cfe-408d-a6f5-968aa7f46923` has origin
`http://localhost`, which accepts callbacks from any localhost port. Leave `PUBLIC_URL` unset:
it defaults to `http://localhost:<PORT>` (port 3000 by default).

Put the three Perminister settings in a `.env` file at the repo root (git ignores it):

```sh
# Fill in the base URL (https://, no trailing slash) and the local client's secret.
PERMINISTER_BASE_URL=
PERMINISTER_APP_CLIENT_ID=10e163a2-1cfe-408d-a6f5-968aa7f46923
PERMINISTER_APP_CLIENT_SECRET=
```

The server does not read `.env` itself, so export it into the shell that runs `pnpm dev`:

```sh
set -a; . ./.env; set +a
pnpm dev
```

Without all three settings the server still starts, but there is no Perminister sign-in.

## Troubleshooting

- `curl -i -X POST https://sky-brain.vercel.app/mcp` must answer `401` with a header
  `www-authenticate: Bearer resource_metadata="https://sky-brain.vercel.app/.well-known/oauth-protected-resource/mcp"`.
- "No access" after sign-in: Perminister signed the person in but has not given them access to
  the `sky-brain` product, or their account has no email. Give them access in Perminister and
  have them sign in again.
- A function that will not start names the missing or wrong setting in Vercel's logs, for
  example `PERMINISTER_APP_CLIENT_ID (or the older PERMINISTER_CLIENT_ID) must be set when NODE_ENV is production; refusing to start`.

## Verified

- claude.ai whoami: returned s…@gmail.com on 2026-11-11
  The address is masked on purpose, because this repo is public: shammai confirmed on 2026-11-11
  that it is his and chose the masked form.
- Deploy checks, run by shammai from his own machine on 2026-11-11 against production built from
  the latest `claude/login-mcp` push: `POST /mcp` answered `status 401`, and
  `/.well-known/oauth-protected-resource/mcp` named the resource `https://sky-brain.vercel.app/mcp`
  with authorization server `https://sky-brain.vercel.app/api/auth`.
- Production branch: for this test Vercel's production branch is `claude/login-mcp`, not `main`
  as [PLAN.md](PLAN.md) §12 says. Switch it back to `main` once the branch is merged.
- Claude phone app: not yet tested
- Claude Code CLI: not yet tested
- Perminister account without `sky-brain` access: not yet tested
- Cold-start timing of the first discovery and token calls: not yet tested
- Steps that differed from this doc: the first claude.ai connect failed with "Couldn't register
  with sky-brain's sign-in service" because an older build was still serving production (the
  `/.well-known` paths returned the web page); a production redeploy from the new branch fixed it.
  The connector also asks for a Name (`sky-brain`).
- Codex CLI and DCR: not yet tested
- Owner of the untested items above: shammai (they need his phone, his Claude Code and a second
  Perminister account); recorded in D19.
