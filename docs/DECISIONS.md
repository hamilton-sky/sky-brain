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

### D19. Better Auth stays, provisionally, until the phone app and Claude Code are tried
**Chosen (2026-11-11):** shammai keeps Better Auth (D7) for now. D18's result stands: claude.ai
passed and no client failed. The decision is provisional because T0's bar also names the Claude
phone app and Claude Code CLI, which have not been tried.
**Open, owner shammai:** the Claude phone app, Claude Code CLI, a Perminister account without
`sky-brain` access (must end at "No access"), cold-start timing of the first discovery and token
calls, and Codex CLI with DCR. Results go in `docs/CONNECT.md` § Verified; the final T0 outcome
(Better Auth kept, or the WorkOS AuthKit fallback if a client fails and cannot be fixed in two
days) is recorded as a new decision.
**Deploy check:** on 2026-11-11, after the latest push of `claude/login-mcp` was deployed,
`POST https://sky-brain.vercel.app/mcp` answered `401` and
`/.well-known/oauth-protected-resource/mcp` named resource `https://sky-brain.vercel.app/mcp`
(shammai, from his own machine).
**Why:** claude.ai works on it and no client has failed; D7's WorkOS fallback is for a client
that fails.
**Rejected:** leaving T0 open with no auth decision until every client is tried.

### D20. Goals and tasks move to sky-brain; devices pull approved work
**Chosen (2026-11-11):** the goals and task DAG of a project (tasks, dependencies, claims, file
claims, attempts) live in sky-brain, one authority per workspace. Workers pull ready tasks and
claim one with a 10-minute lease and a fencing number (`claim_seq`); a late report after the
lease ran out is refused. Only a person approves a goal, and approval pins each task's text: a
task added or changed later waits for a new approval. A device, and an MCP client, sees and
claims only tasks of goals **its own person approved**; being the goal's `assignee` is not
enough (shammai's choice, 2026-11-11, recommended option: "nothing runs on my machines that I
did not see"). Agents propose goals as drafts and add tasks; they never approve. Pathly's
device flow and run tokens (`sbd_`, `sbr_`) and the MCP board tools (`list_projects`,
`list_goals`, `get_goal`, `propose_goal`, `add_tasks`, `next_task`, `claim_task`, `renew_task`,
`release_task`, `report_task`) are two doors to the same routes; the MCP tools call the REST
routers in process, so every check applies to both.
**Supersedes D3** (tasks and task claims; FSM state, events and telemetry stay in Pathly) **and
narrows D1 and CLAUDE.md hard rule 1**: a device may pull and run, without confirmation at the
device, tasks from goals its own person approved in sky-brain; sky-brain still never pushes,
starts, stops or steers anything, and never contacts a machine.
**Numbering:** the cloud-task-board plan called this D19 (or D16 on its branch); login-mcp took
D16 to D19 first, so it is D20.
**Why:** shammai's ask (2026-11-01): two machines split one goal, and a crashed laptop's task
comes back by itself when its lease runs out. D3's "one lock in one place" still holds: the
place is now sky-brain's Postgres (a conditional update under a per-project advisory lock).
**Rejected:**
- Goal checkout (a machine takes a whole goal): one slow machine holds every task of it.
- Registered runners that sky-brain sends work to: that is the cloud steering a laptop, which
  D1 rules out.
- A mirror with local accept (cloud proposes, each laptop confirms): a second copy of the board
  to keep in sync, and the confirmation is the approval the person already gave in the cloud.
- Approved-or-assigned eligibility: another editor's approval would run work on your machines.

### D21. One build order for the memory: the full loop and a measure gate before search tuning
**Chosen (2026-11-15):** the build order of the memory is the nine steps on the architecture page
(`docs/vision/hub/architecture.html` § 8), now written out in `docs/vision/BUILD-PLAN.md`:

0. Benchmark.
1. Reliable memory (extend `entries`, versions, links, episodes, trust, entries API and MCP tools).
2. The full agent loop (packet on claim, evidence on report, proposed lessons, question items, Digest).
3. Measure gate (beat plain retrieval on decisions kept, or fix the loop first).
4. Hybrid search.
5. Cognitive signals, one at a time.
6. The Consolidator.
7. Growth and export.
8. Beyond code.

The memory core extends the existing `entries` table rather than adding an `items` table.
**Why:** the latest outside review (`docs/vision/REVIEW.md`) found that the loop between board and
memory is what proves the brain useful, and search tuning is wasted until it runs. shammai accepted
this order on 2026-11-15.
**Supersedes:** the 14 Nov order in BUILD-PLAN.md (hybrid search as step 3, before the loop) and
the build-order lists in VISION.md. Layers 2 to 5 in `docs/ROADMAP.md` (Pages, Views, Sharing,
Reach) wait until this sequence reaches step 8; each needs its own decision then.
**Rejected:** hybrid search before the loop. It tunes retrieval before anything shows that
retrieval is what limits the agents.

### D22. Two separate fields on a memory item: kind and trust level
**Chosen (2026-11-15):**
- **`kind`** says what sort of statement the item is: `fact`, `decision`, `hypothesis`,
  `observation` or `external`. An `observation` must carry evidence (a test, a CI run, a commit)
  and the time it held, or the Gatekeeper refuses it. `external` is anything imported or from the
  web.
- **Trust level** says how far a person has vetted it: `quarantined`, `proposed` or `approved`.
  External and instruction-like text starts `quarantined`. Everything an agent writes starts at
  `proposed`, whatever its kind.
- **Only a person raises trust**, and only a person changes an item's kind. Agents, Workers and
  Stewards (the Consolidator included) only propose. Nothing is raised automatically: not by
  repetition, not by use, not by importance, and not by a Steward's confidence. Only an approved
  item is used as ground truth in a context packet; the rest is shown as labelled information.
- What the item is about (rule, question, answer, lesson, note, artifact) stays a separate
  property. Step 1 of D21 settles the column names and maps today's `entries.kind` values onto
  this model (today's `claim` is a `hypothesis`; today's `status` carries the trust level).
**Why:** the reviews mixed two questions in one ladder: what an item is, and whether a person
checked it. Keeping them apart lets an agent record an evidence-backed observation without being
able to make it binding, and keeps hard rule 3 simple to test: no agent write path reaches
`approved`.
**Supersedes:** the single four-level ladder (external, hypothesis, observation, approved) on the
architecture page and in BUILD-PLAN.md, and the spec's "the Consolidator promotes" wording.
**Rejected:** automatic promotion by confidence or repetition; a Steward that writes approved
memory.

### D24. Sign in with Perminister uses its OpenID Connect flow

**Date:** 2026-11-23. **Decided by:** a production bug (every sign-in showed Perminister's
"Sign-in request unavailable").
**Decision:** On 2026-11-14 Perminister moved product sign-in to OpenID Connect and kept the old
request shape only for two named products. sky-brain now sends what it asks for:
- The authorize URL carries `scope=openid profile email perminister_api`, a 43-character `nonce`
  and a 43-character `state`. Better Auth 1.7.15 makes a 32-character state and no nonce for a
  provider without discovery, so an after-hook on `/sign-in/social` finishes the URL
  (`auth/perminister-oidc.ts`). The state gets an 11-character suffix derived from it, which the
  `/auth/perminister/callback` route takes off again. The nonce is an HMAC of the PKCE challenge
  under `BETTER_AUTH_SECRET`, so getToken recomputes it from the verifier; nothing is stored.
- getToken exchanges the code at `POST /oauth/token` with HTTP Basic client auth, the fixed
  callback URI and the PKCE verifier; checks the RS256 ID token (signature from
  `/.well-known/jwks.json`, issuer, audience, expiry, nonce); then reads the account and its
  organizations from `GET /api/auth/consumer/session` with the access token and client headers.
  `mayEnter` (D17) is unchanged.
**Why:** the old `POST /api/auth/consumer/token` request is refused for new products.
**Rejected:** using Better Auth's discovery mode, because its 32-character state and nonce are
still refused; an extra redirect hop of our own, because the after-hook keeps one URL.

### D25. Agent profiles: identity, scopes, skills and board triggers per agent (open)

**Date:** 2026-11-23. **Status:** proposed, waiting for shammai.
**Proposal:** add an agent profile that the person creates and binds when a token is issued
(never claimed per call). It carries an identity shown on every row the agent writes, scopes that
start from nothing and can only lower the person's rights, versioned skills served as MCP prompts
and `get_skills`, and triggers that turn board and memory events into activations an agent claims
with a lease. Full design: `docs/vision/AGENTS.md`.
**Why:** today every agent from one app is the same `mcp/<client host>` with the same rights, so a
byline like "Librarian" cannot be trusted, the Consolidator (step 6) cannot be narrowed, and
nothing wakes an agent when the board changes. Notion's Custom Agents (Nov 2026) ship these same
four pieces, which confirms the need.
**Keeps:** hard rules 1 and 3 (no pushed runs; agents never approve), D1, D20 and D22.
**Open:** build identity now, during the step 3 measurement, or wait until step 6.

### D26. Agent identity first: profiles bound per connected app (D25 part 1)

**Date:** 2026-11-23. **Decided by:** shammai ("build identity now", then "merge to main").
**Decision:** build the identity part of D25 now, during the step 3 measurement. A person creates
agent profiles and binds each app they connected (OAuth client, the token's `azp`) to one. The
server resolves the binding on every `/mcp` call and the agent id becomes
`mcp/<client host>/<slug>`, so every existing author and audit column records the role. Unbound
apps stay the Guest agent. Profiles carry no rights yet.
**Why:** the measurement can then tell which role wrote which lesson or entry, and later parts
(scopes, skills, triggers) need an identity to hang on. It changes no permission, so it does not
disturb what is measured.
**Rejected:** a profile claim inside the access token chosen on the consent page. It would need a
change to the Better Auth MCP flow that sign-in depends on (D24 broke sign-in the same day), and a
token would keep its role until it expires. A binding on the server takes effect at once and can
be undone. Limit: one role per app per person; to run two roles side by side, connect two apps
(for example claude.ai as the Product owner, Claude Code as the Doer).
**Open:** D25 parts 2 to 4 (scopes with step 6, then skills, then triggers); run tokens for
devices get a profile when Pathly's client exists.


### D27. The sign-in page is sky-brain's entry page

**Date:** 2026-11-24. **Decided by:** shammai (picked the "Constellation Night" style, then "the
landing page will be the entry page").
**Decision:** `/sign-in` is also the page that explains sky-brain. It shows a 3D star brain
coloured by memory layer, the sign-in button right under it, and the four layers as rings with
About me in the centre (Board, Inbox, Notebooks outward). Clicking a ring scrolls to that layer's
explanation, with what the matching part of a real brain does. The brain itself only lights up
on hover.
**Why:** people arriving from Claude still see the button without scrolling, and people who come
to look first see how the memory works before they sign in. Rings follow the research in
HUMAN-MEMORY.md: working memory is the active part of long-term memory (Cowan), and the self
schema sits at the centre (Conway), so the rings show how active a memory is, not a hierarchy.
**How:** still no inline script or style under `default-src 'self'`: the stylesheet is
`/auth-pages/sign-in.css`, and the brain (plain canvas, no library) is part of
`/auth-pages/sign-in.js`. Motion stops under `prefers-reduced-motion`.


### D28. One theme for the whole product, with panel-frame-ui in the web app

**Date:** 2026-11-24. **Decided by:** shammai (asked to use panel-frame-ui and one theme style,
then chose "keep light, fix it" after a design and an accessibility review).
**Decision:** the web app uses panel-frame-ui (pinned at 0.2.5): its dashboard shell, buttons,
cards, badges, fields, alerts and confirm dialog. Its `--pf-*` tokens are mapped to the sign-in
page's Constellation Night colours (`apps/web/src/theme.css`, `pages/base-style.ts`). Dark and
light both stay. The device setting picks one, and a theme picker in the app can override it.
The choice is saved as `sky-brain-theme` in localStorage, and the sign-in and consent pages read
it too. Light is a "dawn star chart": a cool sky, ink stars and brain points, and more solid
cards. The layer colours were darkened to pass 4.5:1.
**Why:** light reads better in daylight, for people with astigmatism, and for low vision, and
it respects the device setting. The old light theme looked weak because it copied the night sky,
not because light mode is wrong. One look across sign-in, consent and the app makes sky-brain
feel like one product.
**How:** no inline script anywhere. The app applies the saved theme before paint with
`/theme-init.js`, a file. The auth pages do it as the first part of their single script.
panel-frame-ui's own `getThemeBootstrapScript` is inline, so it is not used.

### D29. Open sign-up: any verified Perminister account gets its own brain

**Date:** 2026-11-24. **Decided by:** shammai ("every user can create their own brain").
**Decision:** `mayEnter` no longer asks for an organization of the `sky-brain` product. A person
may enter when Perminister signs them in with an email and the signed ID token says
`email_verified: true`. The sky-brain production app client in Perminister is set to
"Public registration", so Perminister itself hands a code to any active account with a verified
email, and still refuses an account disabled for the product. Everything else in D17 stays:
the first sign-in makes one private workspace (About me, Inbox, Notebook) owned by that person,
workspaces are walled off by membership (hard rule 4), sky-brain invites are accepted at sign-in,
and account linking by email stays off.
**Why:** sky-brain is for organizations and individuals. Asking Perminister's admin to add each
person to an organization does not scale, and a fresh workspace per person needs no sharing
rule to be safe.
**How:** `email_verified` is read from the ID token, which is signed, not from the session
answer. Perminister checks the same thing before it issues a code, so this is a second check.
Taking someone's access away is now done in Perminister by disabling the account for the
product; their session ends within 7 days (no rolling refresh).
**Supersedes:** the product-organization rule in D17.

### D30. Hats: one brain, several identities

**Date:** 2026-11-24. **Status:** design agreed by shammai (24 Nov); not built. A hat is a lens by default, a wall
optionally; no starter hats.
**Proposal:** a person keeps one brain and one About me, and defines hats (Parent, Engineer,
Friend). A hat is an optional property of a memory, About me entries can be tagged with one or
more hats, and each connected app is bound to a hat as well as a role. A hat is a lens (focus,
can be picked per chat) and, if the person wants, a wall (its own connector and token audience).
A new brain starts with no hats and gets suggestions. Under a hat, an agent sees
the shared About me plus that hat's part, reads and writes only that hat's memories and shared
ones, and captures into that hat's Inbox. Hats only narrow rights and are never a grant; "share
this hat" writes one grant per memory. Full design: `docs/vision/HATS-AND-APPROVAL.md`, Part 1.
**Why:** people live in several roles with different context (self-aspects, working
self-concept, encoding specificity). Splitting into several brains would lose what is true in
every role.
**Keeps:** one core per person, sharing per memory, D26 bindings, hard rules 3 and 5.

### D31. Approval through the connected model

**Date:** 2026-11-24. **Status:** design agreed by shammai (24 Nov); not built.
**Proposal:** an agent may ask for approval with `propose_change`; the server creates an
approval request pinned to the exact versions shown, and the person answers through a channel the
agent cannot write to: an approval link opened in their own sky-brain session (every client),
with web inbox, email and later web push to tell them it is waiting. MCP elicitation comes later
and form mode only for low-risk items, because claude.ai does not support it yet and a client hook
can answer it. Riskier changes (About me, trust, delete) need the link plus a passkey; sharing
stays web-only. The web app becomes the place for bulk approval and sharing.
Full design: `docs/vision/HATS-AND-APPROVAL.md`, Part 2.
**Why:** the person works in Claude or Codex and should rarely need to open sky-brain, without
letting a model approve itself.
**Keeps:** hard rule 3 (agents never approve; a tool argument or chat text is never an approval).
**Decided (shammai, 24 Nov):** web push is the second alert channel, after the inbox and email.

### D32. Approval requests: the first step of D31

**Date:** 2026-11-24. **Decided by:** shammai ("merge and continue" after D30 and D31).
**Decision:** build approval requests before hats and alerts. An agent calls `request_approval`
with draft goals or proposed entries and gets a link to `/a/<id>`; the person approves or rejects
on that page or on the Approvals tab. Each item is pinned to the state shown; a change makes the
request `superseded` and nothing is applied. Requests expire after 60 minutes, are decided once,
and are capped at 10 open per agent. Rejecting a request does not reject its items.
**Why:** it works in every client today (claude.ai has no elicitation), and email, web push and
hats all build on it.
**Keeps:** hard rule 3: the approve and reject routes are people only; no MCP tool approves.

### D33. Documents on goals are linked entries; PDFs wait

**Date:** 2026-11-24. **Decided by:** shammai (chose "md now, PDF later").
**Decision:** a goal can carry up to 20 documents. A document is an existing entry (markdown with
the writer's summary, versioned), linked to the goal in a new `goal_documents` table. People and
agents who may write attach one (`POST /goals/:id/documents`, MCP `attach_document`); only a
person removes one. The board shows the summaries on hover and in the goal's dialog, and opens a
document to read it, or to edit it as a new version (its page: D34).
**Why:** the person wants agents' md files on the cards, with their summaries, readable and
editable without leaving the board (as Pathly's artifacts work). Entries already carry a
writer's summary, versions, secret scanning and quarantine, so linking them adds no new trust
rule; sky-brain still never calls an LLM.
**How:** the entry must be in the goal's own workspace and readable by the caller (agents never
see or attach a held one). The web app renders markdown with its own small parser into React
elements, so no HTML from a document reaches the page; a held document shows as plain text.
**Not yet:** PDFs and other files. They need storage and a quarantine rule for text that cannot
be scanned.

### D34. A document page with a Pathly-style editor, and comments people write

**Date:** 2026-11-24. **Decided by:** shammai ("the md editor should not be a modal but a full
page like the board", with Pathly's comments, split and reorder, and formatting).
**Decision:** a document opens on its own page, `/docs/<entry id>`, not in a dialog. The page has
four views: Read (rendered), Sections (a card per heading that can be edited, moved, dragged,
duplicated, deleted, split at the cursor and merged), Source (markdown with a formatting bar:
heading sizes, bold, italic, strikethrough, code, lists, quote, link) and Split (source beside
the rendered text). Edits are a draft with undo and redo until Save writes a new version.
Comments are stored in a new `entry_comments` table: a person selects a passage (or none),
writes a note in one of five colors, and resolves, reopens or deletes it. `GET /entries/:id`
returns the comments, so the model reads them with MCP `get`.
**Why:** reading and editing long md comfortably needs the whole screen and an address to come
back to; comments are how the person tells the model what to change without rewriting it.
**Keeps:** hard rule 3 (agents read comments but never add, resolve or delete them: those routes
are people only); hard rule 4 (comments filter by the entry's workspace, and a reader of the
entry is a reader of its comments; agents never see a held entry's); hard rule 6 (secret scan and
size caps on every comment). Pathly's AI actions are left out: sky-brain never calls an LLM.

### D35. The brain book: one entry point that teaches models to use the brain

**Date:** 2026-11-24. **Status:** proposal from shammai's idea (24 Nov); not built. Revised the
same day after research (`docs/vision/BOOK-RESEARCH.md`): benchmark first, then a thin book (text in
tool descriptions, server instructions, one `book { id? }` tool); the rest waits for triggers.
**Proposal:** a model starts with `book`, a short table of contents of the brain (who you are,
five rules, chapters with one line each), and opens chapters with `book_read` or finds tools,
recipes and pages with `book_search`. Chapters: start here, layers, reading, writing, board,
approval, recipes, errors, and the person's own pages. The built-in text is generated from the
tool registry (`defineTool` with a `book` block) and chapter files in the server, so it never
drifts from the tools, and it is built per caller (role, hat, scopes). The person configures and
extends the book on a Book page (notes, recipes, glossary, order, hide per role). Models propose
pages with `propose_book_page`; a page is served only after the person approves it through an
approval request (level 2, like rules). Usage suggestions come from fixed rules over a log of
tool calls that keeps no arguments. A per-app compact mode exposes 9 tools and reaches the rest
through `look` (read-only) and `act` (writes), which call the same handlers. Skills (D25 part 3)
become a "Your job" chapter. Full design: `docs/vision/BOOK.md`; draft text: `docs/vision/book/`.
**Why:** tools alone do not teach a model how they fit together, and listing every tool in every
chat costs context. A short contents, read on demand, and worked recipes fix both.
**Keeps:** hard rules 2, 3 and 6 (the book adds no rights, agents cannot write guidance without
approval, pages are scanned), D31/D32 approvals, and no model calls inside sky-brain.

### D36. Web push alerts for approval requests

**Date:** 2026-11-24. **Decided by:** shammai (web push before email; Resend later).
**Decision:** a person turns on alerts per browser from the Approvals tab. When an agent asks for
approval, sky-brain sends a VAPID web push to each of that person's subscriptions, with generic
text and the `/a/<id>` path only. The alert's Approve button posts with the person's own session
cookie, the same request the page's button makes; the server's checks (people only, pins, expiry)
are unchanged. Push is off unless the three `VAPID_*` settings are set.
**Why:** no outside account is needed, it works on desktop and Android at once and on iPhone once
sky-brain is on the Home Screen, and the research of 24 Nov ranked it after the inbox.
**Keeps:** hard rule 3 (an alert never approves by itself; the approve route is people only) and
hard rule 5 (nothing secret in a URL; the link carries only the request id).

### D37. The brain book is organized by layer

**Date:** 2026-11-25. **Decided by:** shammai.
**Decision:** the book has one entry, `book`. Its chapters start with the brain's layers (About
me, Notebooks, Inbox, Board); each layer's chapter says what the layer is for, what is in it, how
to use it, and its APIs. Then come chapters for using the brain across layers, approval, recipes,
errors and the person's pages. Opening a layer shows its tools as text; the tool list itself stays
fixed, because clients do not reliably reload tools mid-chat. `search` gains a `layer` filter and a
new `context { q }` returns the packet for all layers together. Design: `docs/vision/BOOK.md`
section 14; draft: `docs/vision/book/`.
**Also decided (25 Nov):** model pages need level 2 approval; full mode stays the default; the usage
log keeps counts only.
**Keeps:** D35 as revised (benchmark first, then a thin book), hard rules 3 and 7.

### D38. Build the book with cross-layer context now, ship it after the measurement window

**Date:** 2026-11-25. **Decided by:** shammai.
**Decision:** the bench did not show the book beating B's descriptions on single tasks, but the
book's purpose is complex requests that pull context from several layers at once. So step 1 is
built now, together, on a branch: `context { q }` (the packet for a free question, across every
layer), a `layer` filter on `search`, the `book { id? }` tool with "Your brain now", server
instructions, and use-when and pitfalls on every tool description. It ships after the two-week
memory-loop window. The bench measures it with arms from the real server (C adds `context`, D adds
`context` and the book) on cross-layer scenarios.
**Keeps:** D35 and D37 (one `book` entry, layer-first chapters), hard rules 3, 4 and 7 (both new
tools are read-only, workspace-filtered, and the packet stays fenced). The live server shows
models nothing new until the PR merges.

### D39. Approve item by item, and keep an entry in the layer the person picks

**Date:** 2026-11-26. **Decided by:** shammai.
**Decision:** an approval request is no longer all or nothing. On `/a/<id>` each item has a
checkbox (ticked by default) and its own Reject; `POST /api/v1/approvals/:id/approve` takes
`{ items: [{ id, action: approve | reject | skip, save_to? }] }`. Skipped items stay as they were;
a rejected entry becomes `rejected`, a rejected goal is cancelled. An approved entry can be kept in
another memory (About me, a Notebook, or left in its Inbox): the server approves the Inbox entry and
captures the person's own copy in the target memory, approved and human-authored, with an
`entry:<id>` ref back to the original. Entries never move (0008), so a copy is the only honest way
to change layer. The agent may suggest `save_to` when it asks; the person sees it preselected. Each
item's `outcome` and `saved_as` are stored in the request's `items` and shown to the agent. The
request is `approved` when at least one item was approved, else `rejected`. No body still means
approve all (with the suggested memories), and `/reject` still applies nothing.
**Keeps:** hard rule 3 (only the person decides; only the owner, in person, writes About me, so an
editor cannot keep something there) and the pin rule (every item the person decides is checked
against what they were shown; skipped items are not).

### D40. A brain view that splits the star brain into its layers

**Date:** 2026-11-26. **Decided by:** shammai.
**Decision:** people could not see their brain's layers. The header's star brain is now the way
in: clicking it opens the same star brain big in the middle of the screen, where it splits into
its parts (About me in the middle, the Board in front, the Inbox below, the Notebooks behind and
to the left). Picking a part shows, in a right panel, the agents that work in it and what it
holds; clicking an item goes to it, and each entry layer gets its own page under `/brain/`. Also
in: names and counts on the parts, a ring where something waits for the person with a Review
button, agent-coloured sparks for agents writing now, a search per part, arcs for items linked
across layers, and keyboard, swipe and remembered-part support. Prototype:
https://claude.ai/artifact/QdWXBDHE9rh9Ry7U91QiTC.
**Keeps:** the brain view is read-only and uses existing, workspace-filtered routes (hard rule 4);
brain.js stays the one star brain for the sign-in page, the header and this view.

### D41. The sidebar's brand banner leads into the brain and its layers

**Date:** 2026-11-26. **Decided by:** shammai.
**Decision:** the layers had no direct way in: only the brain view's icon and its panel. Now the
sidebar's brand banner (the star brain and "skybrain") opens the brain view when clicked, and an
arrow beside it drops the layers down under it as links: About me, Notebooks, Inbox and Board, each
with its layer's colour, the page shown now marked. The list is open by default and its state is
remembered per browser; closed, the Board goes back to the plain page list. The separate "Brain"
sidebar link is gone, since the banner does its job (it is keyboard-reachable too).
Also: a goal clicked in the brain view opens that goal on the Board (`/goals/<id>` picks its
project and opens its dialog), not just the Board page. An agent working a Board task (holding
its lease) shows as working now in the brain view, which reads again every 20 seconds; before,
only saved entries counted, so agents claiming tasks never showed.
**Keeps:** D40 (the brain view and the layer pages); nothing new on the server.

### D43. Every session's real work goes on the Board

**Date:** 2026-11-26. **Decided by:** shammai.
**Decision:** shammai wants each goal and its tasks, from every project and every app, to live in
sky-brain, with every agent working through it. The server instructions every MCP client gets on
connect now say: real work, more than a quick answer, goes on the Board as a goal with tasks,
claimed and reported, with lessons captured. The book gains `recipe:track-work` (chapter 8, and a
step in "start a session") with the order: find the project (ask if none fits), reuse a goal that
covers the work, else propose one with tasks and ask for approval, and keep working meanwhile.
A line in the person's claude.ai preferences (and `~/.claude/CLAUDE.md` on their computer) tells
each session to use the sky-brain connector; the server instructions carry the rest, so it works
the same in Claude, Codex or any other client.
**Keeps:** only goals the person approved run (D20); agents propose, never approve; quick answers
and small talk stay off the Board; server instructions stay at most 512 characters (BOOK.md 11).

### D45. Agents do the everyday work; the weighty actions stay with people

**Date:** 2026-11-26. **Decided by:** shammai.
**Decision:** what a person may do, their agent may do too, except the actions that matter. An
agent (acting for its person, with that person's role) now creates and renames projects and
comments on entries, over REST and through the MCP tools `create_project`, `rename_project` and
`comment`. The checks are the person's: an owner or editor only (a viewer's agent gets 403),
another workspace is 404, and the audit row and the comment name the agent.
Still people only: approve, reject, cancel or release a goal or an entry; delete anything
(comments, document links); resolve or reopen a comment; set a goal's assignee; write versions
of an entry; make a memory; rules; About me; sharing; devices and push; agent profiles and
bindings; approval requests.
**Keeps:** hard rule 3 (agents never approve, reject, release or delete, nor write rules or the
workspace scope); D26 (a role grants no extra rights). Number note: D42 to D44 are taken by hats (PRs #49, #51) and D43 on main.
