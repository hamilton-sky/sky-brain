# sky-brain: decision log

Each decision records what was chosen, why, and what was rejected. To change a decision, add a
new one that supersedes it; do not rewrite the old one.

The reasoning comes from a four-lens review on 2026-11-01: a platform architect, a security
red team, a product strategist and a local-first contrarian. Code findings were checked
against `pathly-adapters`.

---

### D1. A place for context, not for execution
**Chosen:** sky-brain stores and serves knowledge. It never runs agents, holds code or sends
commands.
**Why:**
- Agents need the code, and the board doesn't.
- If the cloud could tell a laptop what to run, one breach would mean commands running on every
  connected machine. Pathly's headless agents also run with permission prompts skipped.
**Rejected:** a cloud runner; Studio on a laptop listening to a cloud spawn stream.

### D2. Our own typed store, not Notion or a memory library
**Chosen:** our own entries table with kinds, statuses, supersede and expiry.
**Why:**
- Notion's API allows about 3 requests a second, and its edit webhooks arrive about a minute
  late. It has no supersede or provenance, and agent runs cost credits.
- mem0, Zep/Graphiti and Letta are built for one agent's memory. None of them settles
  conflicts between agents.
**Rejected:** Notion as the store; mem0, Zep/Graphiti or Letta as the store; forking AFFiNE or
AppFlowy.

### D3. Knowledge moves to the cloud; run data stays in Pathly
**Chosen:**
- **sky-brain holds:** rules, decisions, claims, questions and answers, artifacts, lessons and
  notes.
- **Pathly keeps:** tasks, task claims, FSM state, events and telemetry.
**Why:**
- Task claims need one lock in one place, and gates need the code.
- Splitting by kind avoids rewriting the 43 Pathly modules that read the board: only the
  fragments and `retrieve_board_context` change.
**Rejected:**
- Moving all of Pathly's board to the cloud: weeks of rewrite, and the gates can't follow it.
- Multi-writer sync (Turso Sync, CRDTs, ElectricSQL): it can't give one task to exactly one
  worker.

### D4. TypeScript for the whole stack
**Chosen:** Node and TypeScript for the server, and React for the web.
**Why:**
- Yjs, Hocuspocus and BlockNote, needed for Layer 2, are JavaScript.
- Pathly Studio's components are React and TypeScript and can be reused.
- One language across server, web and shared types.
**Rejected:** a Python server with FastMCP. It is easier for Google OAuth, but it would split the
stack in two once live editing arrives.

### D5. Render Postgres, not SQLite on a disk
**Chosen:** Render Postgres.
**Why:**
- This is new code for several users, so the reason to keep Pathly's SQLite code does not apply.
- A disk on Render rules out zero-downtime deploys and running more than one instance, and its
  automatic snapshot is daily.
- Postgres gives full-text search now and pgvector later.
**Sources:** [Render disks](https://render.com/docs/disks),
[Render Postgres extensions](https://render.com/docs/postgresql-extensions).
**Rejected:** SQLite with Litestream on a VM (right for lifting Pathly as it is, not for a new
multi-user service); Turso; Cloudflare D1.

### D6. One origin for API, MCP, auth and web
**Chosen:** one Render web service serves everything.
**Why:** no cross-site cookies, no wide CORS, one deploy, one health check. Layer 2's websocket
route fits on the same service.

### D7. Better Auth for sign-in and the MCP OAuth server; WorkOS AuthKit as fallback
**Chosen:**
- Better Auth with Google sign-in, the `mcp()`, `cimd()` and `jwt()` plugins, and device
  authorization for CLIs.
- It is proven end to end in ticket T0 before anything is built on it.
**Why:**
- claude.ai connectors need an OAuth server with PKCE and either dynamic client registration or
  a Client ID Metadata Document.
- Google supports neither, so our server must be the OAuth server and send people on to Google
  to sign in.
- Better Auth does this, self-hosted, with CIMD and JWT tokens checked against our own keys.
**Risk:** its MCP docs are partly in beta.
**Sources:** [Claude connector auth](https://www.claude.com/docs/connectors/building/authentication),
[Better Auth MCP plugin](https://better-auth.com/docs/plugins/mcp).
**Rejected for now:** WorkOS AuthKit, which is hosted and mature but a vendor dependency. It
is the fallback if T0 fails.

### D8. Identity comes from the token only; agents get short-lived run tokens
**Chosen:**
- People get sessions.
- MCP clients get JWTs.
- Headless agents get run tokens that last at most 30 minutes, minted for a logged-in device and
  bound to a workspace, project, role and verbs.
**Why:** Pathly today trusts any local caller and takes the author from the request body. Its
run tokens have no time limit, and the spawn stream sends them in the clear. None of that
survives the internet.

### D9. Trust tiers, quarantine and fenced context are in Layer 1
**Chosen:**
- Agents write `proposed`.
- Only people write rules or approve.
- Web-sourced and instruction-like text is quarantined.
- `context` renders entries as quoted data.
**Why:**
- A shared brain is read into every agent prompt, so one poisoned entry spreads everywhere.
- Pathly today puts board text into prompts unfenced, under "do not override".

### D10. A new repo, separate from pathly-adapters
**Chosen:** `hamilton-sky/sky-brain`.
**Why:**
- sky-brain serves Claude, Codex, claude.ai and feature-flow, not only Pathly.
- It is a public service, while pathly-adapters is built around "a local caller is trusted".
- Render redeploys on every push, so sharing a repo with Studio would redeploy the brain on
  unrelated commits.
- The Pathly client changes stay in pathly-adapters.

### D11. Live co-editing with Yjs, for documents only
**Chosen:** Yjs for page content (Layer 2). Entries stay in Postgres with one authority.
**Why:**
- Automatic merging is right for text that several people edit.
- It is wrong for decisions and claims, which need one place that decides.
**Licence note:** use BlockNote's core packages (MPL-2.0). Avoid `@blocknote/xl-*`, which are
GPL-3.0 or commercial.

### D12. The name is sky-brain, for now
**Chosen:** `sky-brain`.
**Why:**
- It ties to `hamilton-sky`: "sky" fits a cloud brain, and "brain" says what it is.
- `sky-brain` and `skybrain` are free on npm and PyPI.
**Known clash:** Skypoint sells "skyBrain", an AI memory product for healthcare that works with
Claude over MCP ([skypoint.ai](https://skypoint.ai/products/skybrain)). That is fine for our
own and open-source use. Pick a distinct product name before any commercial launch.

### D13. TypeScript 6.0, and tsx runs the server in production
**Chosen:**
- TypeScript `~6.0.3`, not 7.
- The server runs from source with `tsx src/main.ts`, in production too. `pnpm build` only
  builds the web shell.
**Why:**
- typescript-eslint 8.72.1 supports `typescript >=4.8.4 <6.1.0`, and TypeScript 7 ships the
  native compiler without the classic compiler API that type-aware lint needs.
- With tsx, `packages/shared` stays TypeScript source: no build order and no export conditions
  to keep in step.
**Rejected:**
- TypeScript 7, until typescript-eslint supports it.
- Bundling the server with esbuild: workspace packages must be bundled while the others stay
  external.
- `tsc` emit with project references and a built `packages/shared`: two outputs to keep in step.
  The deploy feature can switch if cold start matters.

### D14. PGlite is the dev database when `DATABASE_URL` is unset
**Chosen:**
- `pnpm dev` opens PGlite in `apps/server/.pglite` (gitignored; `PGLITE_DATA_DIR` changes it,
  `memory://` keeps it in memory) and applies the migrations at start.
- With `DATABASE_URL` set the server uses Postgres through node-postgres; Render migrates it in
  `preDeployCommand`. With `NODE_ENV=production` and no `DATABASE_URL` the server refuses to
  start.
- Tests use an in-memory PGlite with every migration applied.
**Why:**
- `pnpm dev` must work on a fresh clone with no service to install.
- PGlite 0.5.14 is Postgres 18.6, the major `render.yaml` asks Render for, so the same
  drizzle-kit migrations, tsvector column and triggers run in dev, tests and production.
**Rejected:**
- A local Postgres (Docker) for dev: one more thing to install before `pnpm dev` works.
- Falling back to PGlite in production: a deploy without its database would silently lose data.

### D15. A dev actor header, only in development and only on 127.0.0.1
**Chosen:**
- Until the auth feature lands, `pnpm dev` takes the caller from an `X-Dev-Actor` header that
  holds the actor JSON, for example
  `{"kind":"agent","agent_id":"claude-code/builder","on_behalf_of":"u1"}`.
- It is an allow-list: honoured only when `NODE_ENV` is exactly `development` (`pnpm dev` sets
  it in `src/dev.ts`). Unset, `test`, `production` and anything else keep it off.
- While it is on, the server listens on 127.0.0.1 only, and honours the header only when the
  request's `Host` is `127.0.0.1`, `localhost` or `[::1]`; any other `Host` is 401
  `dev_actor_disabled`. The bind alone does not stop DNS rebinding: a page on another name that
  resolves to 127.0.0.1 is same-origin to the browser and could send the header.
- When it is off, a request carrying the header is refused loudly with 401
  `dev_actor_disabled`, even if it also carries a valid token. A malformed header is 401
  `invalid_dev_actor`.
- The auth feature replaces it with sessions and tokens behind the same `ActorResolver`.
**Why:**
- The core API needs a caller before real sign-in exists, and CLAUDE.md hard rule 2 rules out
  identity from a request body.
- An allow-list fails closed: a deploy that forgets `NODE_ENV` does not trust the header.
- Refusing the header instead of ignoring it makes a misconfigured client fail at once.
**Rejected:**
- Refusing the header only when `NODE_ENV=production`: an unset `NODE_ENV` would trust it.
- Ignoring the header when it is off: a client could believe it was acting as someone it was not.

### D16. Host everything on Vercel, with Postgres on Nanogres
**Chosen:**
- One Vercel project serves the whole app. The Vite build is the static output. The Express
  app is one Vercel function (`api/index.mjs`), and `vercel.json` rewrites `/healthz`,
  `/api/*`, `/mcp`, `/.well-known/*`, `/sign-in`, `/consent`, `/auth-pages/*` and `/auth/*`
  to it. Every other path falls back to `index.html`. One origin, as D6 asks.
- For the function only, the server is bundled with esbuild (`build:vercel`):
  `packages/shared` is bundled in, other packages stay external and Vercel traces them.
  `pnpm start` still runs from source with tsx (D13).
- Postgres is Zakai's Nanogres over TLS PgBouncer: `DATABASE_URL` for the app role,
  `MIGRATION_DATABASE_URL` for the migrate role, which runs `SET ROLE` to
  `MIGRATION_DATABASE_ROLE` (the database owner) before the migrations. Migrations run in the Vercel build, and only
  for production deploys.
- No Next.js: the Express server, Better Auth and MCP code stay as they are.
**Why:** shammai asked for everything on Vercel instead of Render (2026-11-09). Express runs
there unchanged, so login-mcp needs no rewrite.
**Watch:**
- The write rate limiter is in memory per instance, so on Vercel it limits per instance only.
  It needs a shared store (Postgres) before real use.
- Layer 2's websocket route (D6, D11) cannot run on Vercel functions. It needs a small
  separate service when Layer 2 starts.
- claude.ai waits at most 10 s for discovery and token calls, so cold start plus the first
  Nanogres connect must stay well under that.
**Supersedes:** Render hosting in D5 and D6 and `render.yaml`, which is removed.

### D17. One workspace per person, and Perminister sign-in
**Chosen:**
- Perminister is the only sign-in. Better Auth's `genericOAuth()` plugin holds it as the
  `perminister` provider, and the user is keyed by Perminister's `subjectId` (the `account` row),
  with account linking by email off.
- `mayEnter` (`apps/server/src/auth/access.ts`) is the whole access rule: a person may enter when
  Perminister signs them in with an email and its token exchange lists an organization for the
  product `sky-brain`. An account with no email is refused. It runs as Better Auth's
  `user.validateUserInfo`, before the user is created and on every later sign-in, so access
  taken away in Perminister refuses the next sign-in (`/sign-in?error=no_access`). shammai chose
  this on 2026-11-09: Perminister is invite-only for this product, so its invitations are the
  gate.
- Each person gets one workspace of their own, as `owner`, at their first sign-in (no `members`
  row at all). Pending sky-brain invites for their email, in any case, are accepted on every
  sign-in, so an invite to someone who already has an account works at their next sign-in. A
  sky-brain invite alone lets nobody in.
- Workspaces are walled off by membership (hard rule 4): `/api/v1` takes the caller from the
  session cookie, and every scope check joins `members`.
**Why:** Perminister already holds who may use the product, so a second list in sky-brain would
drift. One rule in one function keeps a later gate (an allowlist, a Perminister role) a
one-function change. A board per person needs no schema change.
**Rejected:**
- The `ALLOWED_EMAILS` allowlist with `BOOTSTRAP_OWNER_EMAIL`: a second list of people to keep
  in step with Perminister.
- Google sign-in: shammai replaced it with Perminister.

### D18. T0 result: claude.ai connects through Better Auth; other clients not yet tested
**Result (2026-11-11):**
- claude.ai passed. shammai added the custom connector (URL `https://sky-brain.vercel.app/mcp`,
  no client id or secret), signed in with Perminister, allowed consent, and `whoami` returned his
  email and one workspace with role `owner`.
- The deploy was branch `claude/login-mcp` at commit 0cd813d, with Vercel's production branch
  switched to it for the test. Discovery at
  `/.well-known/oauth-authorization-server/api/auth` answered with issuer
  `https://sky-brain.vercel.app/api/auth` and `client_id_metadata_document_supported: true`.
- Not yet tested: the Claude phone app, Claude Code CLI, a Perminister account without
  `sky-brain` access, cold-start timing, and Codex CLI with DCR. `docs/CONNECT.md` § Verified
  keeps the list.
**Setup tested:**
- Sign-in with Perminister through Better Auth's `genericOAuth()`, users keyed by Perminister
  `subjectId` (D17).
- Better Auth 1.7.15 with `@better-auth/mcp` and `@better-auth/cimd` 1.7.15, pinned exactly.
- Issuer `<PUBLIC_URL>/api/auth`; resource `<PUBLIC_URL>/mcp`.
- CIMD on, with the resolve-once transport (`fetchClientMetadataResource` from
  `@better-auth/cimd/node`); DCR off.
- MCP callers are agents `mcp/<client host>` acting for the token's person across their
  workspaces.
- `createMcpHandler` with its default `legacy: "stateless"`; scopes are advertised, not yet
  required.
**Chosen:** Better Auth stays (D7). No client failed, so the WorkOS AuthKit fallback is not
taken. T0's bar (claude.ai, the phone app and Claude Code all pass) is met for claude.ai only; the
other clients are still to be tried.

### D19. Better Auth stays provisionally, until the phone app and Claude Code are tried
**Chosen:** Better Auth stays for now (D7, D18), on the claude.ai result alone. This is
provisional and pending shammai's answer: T0's bar asks for claude.ai, the phone app and Claude
Code to pass, and only claude.ai has been tried.
**Why:**
- claude.ai, the main client, passed end to end, and on 2026-11-11 shammai checked the deploy
  from his own machine against production built from the latest `claude/login-mcp` push:
  `POST /mcp` answers 401 and the protected-resource metadata names
  `https://sky-brain.vercel.app/mcp`.
- No client has failed, so nothing points to the WorkOS AuthKit fallback yet.
**Open:**
- shammai has not yet answered whether Better Auth stays provisionally or T0 stays open.
- Still to try, owned by shammai (follow-up in `plans/login-mcp/followups.md`): the Claude phone
  app, Claude Code CLI, a Perminister account without `sky-brain` access, cold-start timing of
  the first discovery and token calls, and Codex CLI with DCR. `docs/CONNECT.md` § Verified keeps
  the list. The final T0 result goes in a new D entry.
**Qualifies:** D18's "Chosen" line: Better Auth stays provisionally, not on T0's full bar.
