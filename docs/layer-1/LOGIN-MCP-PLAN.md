# sky-brain: Google sign-in and MCP connector plan

_Superseded in part: steps 3 to 8 are built by `plans/login-mcp`. Sign-in is Perminister, not Google. Hosting is Vercel + Nanogres (D16), which replaces the Render sketch and "D13" below. The resource metadata URL is the path form `/.well-known/oauth-protected-resource/mcp` (both paths answer). Deploy and connect steps: [docs/CONNECT.md](../CONNECT.md)._

_Written 2026-11-01. Awaiting review._

## Summary

Build Google sign-in and the claude.ai MCP connector as one vertical slice, starting with the T0 auth spike, and host it on Render's free tier at `https://sky-brain.onrender.com`. This plan is written now rather than after brain-core, for two reasons found in the repo:

- **Nothing is built yet.** `main` holds only a LICENSE. The branch `claude/magical-johnson-ifga7u` holds the plan, roadmap, decisions and Layer 1 tickets, but no code and no tests.
- **Login and MCP are part of brain-core, not after it.** `docs/layer-1/TICKETS.md` makes T0 (auth spike) the first ticket, and T3 (Google sign-in), T6 (MCP server) and T9 (deploy) sit inside Layer 1. So this plan covers T0, T3, T6 and the deploy half of T9, and slots into the existing ticket order.

The stack stays as `docs/PLAN.md` says: Node 22, Express 5, Better Auth (`mcp`, `cimd`, `jwt`, Google), the MCP TypeScript SDK, Drizzle, Vitest with PGlite.

## Decisions to confirm

| # | Question | Recommendation | Why |
| --- | --- | --- | --- |
| 1 | Free tier, when `docs/PLAN.md` section 12 says "use a paid instance"? | Free web service + free Postgres for T0 and the build. Move the web service to a paid instance and the database to a paid plan before real data goes in. Record this as decision D13. | Free is fine for a spike. But free Postgres is deleted 30 days after creation (14-day grace) and has no backups, and a sleeping service takes about a minute to wake while claude.ai waits only 10 seconds on OAuth endpoints. |
| 2 | Start now, or wait until the rest of brain-core is done? | Start now with T0. | T0 is already the first ticket, and its result decides whether T3 and T6 use Better Auth or WorkOS AuthKit. |
| 3 | Better Auth or WorkOS AuthKit? | Better Auth, as D7 says, with a two-day limit in T0. | Better Auth's `mcp()` + `cimd()` plugins match claude.ai's CIMD path. If T0 fails, switch to WorkOS and log it. |
| 4 | Dynamic client registration (DCR)? | Keep it off. | claude.ai and Claude Code both use CIMD when the server advertises it. Turn DCR on only if Codex CLI needs it. |

## How login works

sky-brain is its own OAuth 2.1 server, and Google is only the sign-in page behind it. Google cannot be the connector's OAuth server directly, because it supports neither DCR nor CIMD.

**People on the web** sign in with Google through Better Auth and get a session cookie on the same origin. Only invited emails get a workspace; `BOOTSTRAP_OWNER_EMAIL` makes the first owner.

**claude.ai adding the connector** goes like this:

1. claude.ai calls `POST /mcp` with no token. The server answers `401` with `WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource"`. A `401` is required; claude.ai ignores the header on a `200`.
2. claude.ai reads that document. Its `resource` must equal `https://<host>/mcp` exactly, and its first `authorization_servers` entry must be our issuer, `https://<host>/api/auth`.
3. claude.ai reads our authorization server metadata. It uses CIMD only if it sees both `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`, plus `code_challenge_methods_supported: ["S256"]`.
4. claude.ai sends the user to `/api/auth/oauth2/authorize` with its CIMD URL as `client_id` and a PKCE S256 challenge. Better Auth fetches the metadata document and checks the redirect URI.
5. No session yet, so Better Auth shows our `/sign-in` page, which sends the user to Google, then to our `/consent` page. The consent page shows the redirect host clearly.
6. Better Auth redirects to `https://claude.ai/api/mcp/auth_callback` with a code. claude.ai swaps it at `/api/auth/oauth2/token` (form-urlencoded body) for a JWT access token and a rotating refresh token.
7. Every `/mcp` call carries `Authorization: Bearer <jwt>`. The server checks signature (our JWKS), issuer, audience `https://<host>/mcp`, expiry and scopes, then loads the user and their workspace membership.

**Claude Code CLI** follows the same steps but uses its own CIMD and a loopback redirect such as `http://localhost:3118/callback`. The server must match `http://localhost/callback` and `http://127.0.0.1/callback` with the port ignored. T0 checks that Better Auth's `cimd()` does this.

**Hard limits from claude.ai** to design around: 10 seconds for discovery and token endpoints, 30 seconds for refresh, `invalid_grant` when a refresh token is dead, and requests coming from `160.79.104.0/21`.

## MCP server design

One Express app serves everything from one origin, as D6 says:

| Route | What it does |
| --- | --- |
| `/api/auth/*` | Better Auth: Google sign-in, OAuth 2.1 server (`/oauth2/authorize`, `/oauth2/token`, `/jwks`), its own metadata |
| `/.well-known/oauth-protected-resource` | Protected resource metadata, served by the `mcp()` plugin |
| `/.well-known/oauth-authorization-server/api/auth` | Authorization server metadata (issuer-inserted path), also proxied at the root path for clients that probe there |
| `/mcp` | MCP streamable HTTP, stateless, wrapped in `requireMcpAuth(...)` |
| `/sign-in`, `/consent` | Small server-rendered pages for the OAuth flow |
| `/healthz` | Returns `200` with the commit id; no database call, so it answers fast |

The auth setup, based on [Better Auth's MCP plugin docs](https://better-auth.com/docs/plugins/mcp):

```ts
export const auth = betterAuth({
  baseURL: `${env.PUBLIC_URL}/api/auth`,
  database: drizzleAdapter(db, { provider: "pg" }),
  socialProviders: { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } },
  plugins: [
    jwt(),
    mcp({ loginPage: "/sign-in", consentPage: "/consent", resource: `${env.PUBLIC_URL}/mcp` }),
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
  ],
});
```

**Tools.** T0 ships one tool, `whoami`, which returns the signed-in email and workspace. T6 adds the six Layer 1 tools (`context`, `search`, `get`, `post`, `supersede`, `ask`). Each tool calls the same service layer as REST, gets the identity only from the verified token, and runs every query through a workspace-membership filter.

**Scopes.** Start with two: `brain:read` and `brain:write`, plus `offline_access` so claude.ai gets a refresh token. Rules, approve, reject, release and delete stay human-only REST routes and are never MCP tools.

**Version pinning.** Better Auth's MCP docs move fast and parts are marked beta. Pin exact versions of `better-auth`, `@better-auth/mcp`, `@better-auth/cimd` and the MCP SDK in T0, and record them in `CLAUDE.md`.

## Build steps, in order

Each step is one PR with its own tests. Tests run on PGlite (Postgres inside the test process), so no Docker is needed.

1. **T1-lite scaffold.** pnpm workspace with `apps/server` and `packages/shared`, strict TypeScript, Vitest, a GitHub Actions job for lint, typecheck and test, and `/healthz`. The web app waits for T8.
2. **Database harness.** Drizzle with the Better Auth tables plus `workspaces`, `members` and `invites`. A `makeTestDb()` helper that builds a fresh PGlite database and runs the migrations for each test file.
3. **Google sign-in (T3 core).** Better Auth with Google, `BOOTSTRAP_OWNER_EMAIL`, and a hook that refuses a workspace to uninvited emails. Tests:
   - an invited email gets in with the right role;
   - an uninvited email gets "no access";
   - the bootstrap owner is created once, not on every sign-in.
4. **OAuth server.** Add `jwt()`, `mcp()` and `cimd()`. Tests (Supertest against the app, with Google mocked):
   - discovery documents carry the exact `resource`, issuer, `S256`, `none` and the CIMD flag;
   - a CIMD client with redirect `https://claude.ai/api/mcp/auth_callback` completes authorize → token with PKCE;
   - a wrong redirect, a missing PKCE verifier, and a reused code are refused;
   - `http://localhost:<any port>/callback` is accepted for a Claude Code-style client;
   - the token endpoint accepts form-urlencoded and returns `invalid_grant` for a dead refresh token.
5. **MCP endpoint with `whoami`.** Tests:
   - no token → `401` with the `resource_metadata` header;
   - a token with the wrong audience, a wrong issuer or an expired token → `401`;
   - a good token → `whoami` returns the email from the token, even when the request body names someone else.
6. **Deploy to Render** (next section) and run the T0 manual checks.
7. **T0 gate.** If claude.ai, the phone app and Claude Code all pass within two days, keep Better Auth. If not, switch to WorkOS AuthKit and add a decision to `docs/DECISIONS.md`.
8. **T6 tools.** After T4 and T5 land, replace `whoami` with the six tools. Each tool gets an allowed-case and a refused-case test, plus a cross-workspace test.

## Deploy on Render's free tier

The result is a public HTTPS address, `https://sky-brain.onrender.com`, with a managed certificate and nothing to configure for TLS. If that name is taken, Render adds a suffix; use whatever address the dashboard shows as `PUBLIC_URL`.

**Free tier facts that shape the setup** ([Render free docs](https://render.com/docs/free)):

- The web service sleeps after 15 minutes with no traffic and takes about one minute to wake.
- 750 free instance hours per workspace per month; one always-on service uses at most 744.
- Free Postgres: 1 GB, one per workspace, no backups, deleted 30 days after creation (14-day grace to upgrade).
- No shell on free instances. Pre-deploy commands are, as far as I know, paid-only, so migrations run at start instead. Check this in the dashboard during step 3.

**Step 1. Add `render.yaml`** at the repo root (format from the [Blueprint spec](https://render.com/docs/yaml-spec)):

```yaml
databases:
  - name: sky-brain-db
    plan: free
    databaseName: sky_brain
    user: sky_brain
    postgresMajorVersion: "17"

services:
  - type: web
    name: sky-brain
    runtime: node
    plan: free
    branch: main
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm build
    startCommand: pnpm --filter server db:migrate && pnpm --filter server start
    healthCheckPath: /healthz
    envVars:
      - key: NODE_VERSION
        value: "22"
      - key: DATABASE_URL
        fromDatabase: { name: sky-brain-db, property: connectionString }
      - key: BETTER_AUTH_SECRET
        generateValue: true
      - key: PUBLIC_URL
        sync: false
      - key: GOOGLE_CLIENT_ID
        sync: false
      - key: GOOGLE_CLIENT_SECRET
        sync: false
      - key: BOOTSTRAP_OWNER_EMAIL
        sync: false
```

**Step 2. Create the Google OAuth client.**

1. Open [Google Cloud console](https://console.cloud.google.com/), create a project named `sky-brain`.
2. Go to Google Auth Platform → Branding. Set the app name, your support email and your developer email. Audience: External. Leave it in Testing and add your own Gmail as a test user.
3. Go to Clients → Create client → Web application.
4. Authorized JavaScript origin: `https://sky-brain.onrender.com`.
5. Authorized redirect URI: `https://sky-brain.onrender.com/api/auth/callback/google`. Add `http://localhost:3000/api/auth/callback/google` for local work.
6. Copy the client ID and secret. Keep them out of the repo and out of chat.

**Step 3. Create the Blueprint on Render.**

1. Sign in at [dashboard.render.com](https://dashboard.render.com) with GitHub and give Render access to `hamilton-sky/sky-brain`.
2. New → Blueprint → pick `sky-brain`, branch `main`.
3. Render asks for the `sync: false` values. Enter `PUBLIC_URL=https://sky-brain.onrender.com`, the Google ID and secret, and your email as `BOOTSTRAP_OWNER_EMAIL`.
4. Apply. Render creates the database, then builds and starts the web service.
5. Open `https://sky-brain.onrender.com/healthz`; it should return `200`.
6. Open `https://sky-brain.onrender.com/.well-known/oauth-protected-resource`; `resource` must read `https://sky-brain.onrender.com/mcp`.

**Step 4. Keep it awake (optional, recommended for the connector).** Add a GitHub Actions workflow on `schedule: cron: "*/10 * * * *"` that runs `curl -fsS https://sky-brain.onrender.com/healthz`. That keeps the service inside the 750 hours and avoids a cold start breaking claude.ai's 10-second OAuth wait. GitHub can delay scheduled runs, so before connecting, also open `/healthz` in a browser to wake it.

**Step 5. Before real data.** Set a calendar reminder for day 25 after the database was created. Either upgrade the database to a paid plan (which adds backups) or recreate it, because the free one is deleted after day 44.

## Connect the clients (T0 manual checks)

Wake the service first by opening `/healthz`, then:

- [ ] **claude.ai (web):** Settings → Connectors → Add custom connector. Name `sky-brain`, URL `https://sky-brain.onrender.com/mcp`, leave the client ID and secret empty. Click Connect, sign in with Google, approve. In a chat, ask Claude to call `whoami`; it should return your email.
- [ ] **Claude phone app:** the connector added on the web shows up there. Ask for `whoami` from the phone.
- [ ] **Claude Code CLI:** `claude mcp add --transport http sky-brain https://sky-brain.onrender.com/mcp`, then run `/mcp` inside Claude Code and pick sky-brain to sign in. `whoami` should return your email.
- [ ] **Codex CLI:** try the same URL. Write down whether it needs DCR; if it does, that becomes a separate decision.
- [ ] **Cloud sessions:** add `sky-brain.onrender.com` to the environment's allowed domains, then repeat the Claude Code check.

The exact steps that worked go into `docs/CONNECT.md`, which T9 already asks for.

## Risks and done when

| Risk | What happens | Answer |
| --- | --- | --- |
| Cold start | claude.ai gives up after 10 seconds while the service wakes (about 60) | Keep-alive ping; open `/healthz` before connecting |
| Free database deleted | All data gone 30 days after creation, plus 14 days grace | Spike data only; upgrade before real use |
| Better Auth MCP churn | Plugin APIs or the CIMD profile change under us | Pin versions; two-day limit, then WorkOS |
| Loopback redirect match | Claude Code login fails if ports are matched strictly | Test in step 4; patch or configure before T6 |
| Google app in Testing | Only listed test users can sign in | Fine for you; publish the consent screen before inviting a team |

**Done when:**

- [ ] CI is green, and every test listed in the build steps passes on PGlite.
- [ ] `https://sky-brain.onrender.com/healthz` returns `200` over HTTPS.
- [ ] claude.ai, the phone app and Claude Code each sign in with Google and get your email from `whoami`.
- [ ] An uninvited Google account gets "no access" on the web and no workspace through the connector.
- [ ] `docs/DECISIONS.md` has D13 (free tier for now) and the T0 result.
- [ ] `docs/CONNECT.md` has the steps that worked.

**Needs from you before T0 starts:** a Google OAuth client (step 2), a Render account linked to GitHub (step 3), and push access for this project to `hamilton-sky/sky-brain`.

## Sources

- [Claude connector authentication](https://claude.com/docs/connectors/building/authentication)
- [Better Auth MCP plugin](https://better-auth.com/docs/plugins/mcp)
- [Render: deploy for free](https://render.com/docs/free)
- [Render Blueprint YAML reference](https://render.com/docs/yaml-spec)
- Repo docs on branch `claude/magical-johnson-ifga7u`: `docs/PLAN.md`, `docs/DECISIONS.md`, `docs/layer-1/TICKETS.md`
