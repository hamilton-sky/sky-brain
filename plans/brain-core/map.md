# Map: brain-core

## Destination

sky-brain's core runs offline: a pnpm monorepo (`apps/server`, `apps/web`, `packages/shared`)
with strict TypeScript, ESLint, Prettier, Vitest and GitHub Actions CI; a Drizzle schema with
migrations that run on PGlite in tests and dev and on Postgres in production; an Express 5
server whose `/api/v1` entries routes enforce every trust rule of PLAN section 6 for an actor
resolved by pluggable middleware (tests, or the dev-only `X-Dev-Actor` header); and the fenced,
budgeted `context` packet. Login, MCP and deploy plug into it in later features.

**The bar.** On a fresh clone,
`pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` exits 0, with tests
proving the seven trust properties in spec.md "Goal and the bar", and
`node tools/dev-smoke.mjs` prints `healthz 200` (`pnpm dev` answers `GET /healthz` with 200).
The acceptance ticket (11, the last in the graph) runs both.

## How to work this

- See what is ready: `python3 scripts/flow-status.py brain-core`. Take the lowest numbered READY ticket.
- Claim: set `Status: claimed` in the ticket and save before starting.
- Resolve: write the result under `## Answer`, set `Status: resolved`, then add one line to
  Decisions so far below.
- See the graph: `python3 scripts/flow-status.py brain-core --mermaid` (coloured by status, drawn on demand).
- Commands live in `commands.md` (frozen). Lessons live in `learnings.md` (append only).
- Status lives only in the ticket files. This map never repeats it.

## Decisions so far

- plan — The repo had no code at planning time; until the first ticket adds `package.json`,
  every command in `commands.md` passes without doing anything (the `[ ! -f package.json ] ||`
  guard), so the flow's smoke and base gate can run on the empty base.
- plan — Versions on npm on 2026-11-01, used for pins: express 5.3.0, drizzle-orm 0.45.4
  (1.0 is still beta), drizzle-kit 0.31.11, @electric-sql/pglite 0.5.14, vitest 5.0.5 (needs
  Node ^22.12), vite 8.3.5, @vitejs/plugin-react 6.1.2, react 19.3.1, typescript 6.0.3,
  eslint 10.14.0, typescript-eslint 8.72.1, prettier 3.9.10, zod 4.6.7, tsx 4.23.15, pg 8.23.1;
  pnpm 10.28.0 and Node 22.23.4 are installed here. docs: https://registry.npmjs.org (`npm view`)
- plan — typescript-eslint 8.72.1 declares the peer `typescript >=4.8.4 <6.1.0`, so TypeScript
  stays on 6.0.x; TypeScript 7's package exposes only `unstable/*` APIs. docs:
  https://registry.npmjs.org/typescript-eslint (`npm view typescript-eslint@8.72.1 peerDependencies`)
- plan — TypeScript 6.0 changes defaults: `strict` true, `module` esnext, `target` es2025,
  `types` `[]` (list `"node"` yourself), `rootDir` is the tsconfig folder,
  `noUncheckedSideEffectImports` true; `baseUrl` and `moduleResolution node10` are deprecated.
  docs: https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- plan — Spike (scratch folder, not committed): TypeScript 6.0.3 + typescript-eslint 8.72.1
  type-checked config + ESLint 10 + Vitest 5 + Prettier ran green in a pnpm workspace whose
  packages import `@sky-brain/shared` as TypeScript source (`exports` pointing at `.ts`), and
  `pnpm exec vitest run --root plans/brain-core/acceptance` ran tests that import
  `../../../apps/server/src/*.ts` and PGlite from there. `pnpm -r --if-present test` prints
  "No projects found" and exits 0 in a folder with no `package.json`.
- plan — Spike: drizzle-kit 0.31.11 turns a `customType` tsvector column with
  `.generatedAlwaysAs(sql\`to_tsvector('english', ...)\`)` into `GENERATED ALWAYS AS (...) STORED`,
  and `index().using("gin", t.search)` into `USING gin`. `drizzle-orm/pglite/migrator`
  (`migrate(db, { migrationsFolder })`) applies it on PGlite 0.5.14, which reports
  "PostgreSQL 18.6"; `'english'` stemming works (`migration running` matched
  `running migrations`). Each `await PGlite.create()` took about 2.7 to 4 s here and
  `clone()` about 1 s; a script that never closed its PGlite instances did not exit.
  docs: https://orm.drizzle.team/docs/generated-columns, https://orm.drizzle.team/docs/connect-pglite
- plan — Postgres generated columns must use immutable functions (two-argument `to_tsvector`
  with an explicit config is); sequences are not gapless and promise no commit order.
  docs: https://www.postgresql.org/docs/current/ddl-generated-columns.html,
  https://www.postgresql.org/docs/current/functions-sequence.html
- plan — Express 5: rejected promises from async handlers reach error middleware; a
  four-argument error handler still shapes the JSON error; `req.body` is undefined when no
  parser ran; wildcards are written `/*splat`. docs: https://expressjs.com/en/guide/migrating-5.html
- plan — Render Blueprint: `services` (`type: web`, `runtime: node`, `buildCommand`,
  `startCommand`, `preDeployCommand` runs after build and before start, `healthCheckPath`,
  `envVars` with `fromDatabase: {name, property: connectionString}`) and `databases`
  (`name`, `plan`, `databaseName`, `user`, `postgresMajorVersion` as a string); smallest paid
  plans are `0.5c-512mb` (web) and `0.1c-256mb` (Postgres). docs: https://render.com/docs/blueprint-spec
- plan — Render Postgres fully supports PostgreSQL 13 through 18, so `render.yaml` asks for 18,
  the major PGlite 0.5.14 runs. docs: https://render.com/docs/postgresql-upgrading
- plan — Render picks the Node version from `NODE_VERSION`, `.node-version`, `.nvmrc`, then
  `engines.node` in `package.json`, and advises an upper bound on the range. It does not
  document pnpm or corepack. docs: https://render.com/docs/node-version
- plan — Secret rules are taken from gitleaks v8.28.0 (`anthropic-api-key`, `openai-api-key`,
  `github-pat`, `github-fine-grained-pat`, `github-oauth`, `github-app-token`, `gcp-api-key`,
  `aws-access-token`, `private-key`; `generic-api-key` uses an entropy floor of 3.5). docs:
  https://raw.githubusercontent.com/gitleaks/gitleaks/v8.28.0/config/gitleaks.toml
- plan — OWASP: keyword screening for prompt injection "is not a security boundary"; enforce
  controls outside the model. docs:
  https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- plan — Spike (scratch folder, not committed), drizzle-kit 0.31.11 on PGlite 0.5.14:
  `pgSequence("entries_seq")` becomes `CREATE SEQUENCE "public"."entries_seq"` in the generated
  migration and a column default ``sql`nextval('entries_seq')` `` becomes `DEFAULT
  nextval('entries_seq')`; `drizzle-kit generate --custom --name=audit-append-only` writes an
  empty `00NN_audit-append-only.sql`, adds it to `drizzle/meta/_journal.json`, and
  `migrate()` from `drizzle-orm/pglite/migrator` applies it. A plpgsql `BEFORE UPDATE OR DELETE
  ... FOR EACH ROW` trigger plus a `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger made all
  three raise on PGlite; `foreignKey({ columns, foreignColumns }).onDelete("cascade")` became a
  composite `ON DELETE cascade` key that refused an entry whose project is in another workspace;
  deleting a workspace cascaded through projects and entries (with a `supersedes` pair and a
  `reply_to` answer) and left an `audit_log` table with no foreign key untouched.
  docs: https://orm.drizzle.team/docs/sequences,
  https://orm.drizzle.team/docs/kit-custom-migrations,
  https://orm.drizzle.team/docs/indexes-constraints,
  https://www.postgresql.org/docs/current/sql-createtrigger.html ("triggers may be defined to
  fire for TRUNCATE, though only FOR EACH STATEMENT"),
  https://www.postgresql.org/docs/current/plpgsql-trigger.html
- plan — Full-text search: `websearch_to_tsquery` turns unquoted words into `&` terms, the word
  "or" into `|`, a dash into `!`, ignores other punctuation, and "will never raise syntax
  errors"; `ts_rank([weights,] vector, query [, normalization])` ranks by matching lexemes.
  Spike on PGlite 0.5.14: `websearch_to_tsquery('english', 'pglite or boot or or migration')`
  gives `'pglite' | 'boot' | 'migrat'`, a query of only stop words gives an empty query that
  matches nothing, and `booting or migrations or the` matched both the "boots" and the
  "migrations" rows. docs: https://www.postgresql.org/docs/current/textsearch-controls.html
- plan — pnpm 10 "doesn't run the lifecycle scripts of dependencies unless they are listed in
  onlyBuiltDependencies", and reads settings from `pnpm-workspace.yaml`. docs:
  https://pnpm.io/10.x/settings
- plan — CI actions: `pnpm/action-setup` (v6 in its README) takes its pnpm version from the
  `packageManager` field when `version` is omitted; `actions/setup-node` (v7 in its README)
  caches pnpm with `cache: pnpm`, but pnpm "should be pre-installed", so `pnpm/action-setup`
  runs first. docs: https://github.com/pnpm/action-setup, https://github.com/actions/setup-node
- plan — typescript-eslint flat config: `recommendedTypeChecked` with
  `parserOptions.projectService: true`, and `disableTypeChecked` for `**/*.js` files. Spike: the
  same shape ran green on the monorepo. docs:
  https://typescript-eslint.io/getting-started/typed-linting, https://typescript-eslint.io/users/configs
- plan — Vitest runs with no config file ("If no config file is found, Vitest will run without
  one"); `testTimeout` defaults to 5,000 ms in Node. docs: https://vitest.dev/config/,
  https://vitest.dev/config/testtimeout
- plan — `tsx watch <file>` runs a script and restarts it on change (`tsx --help` of tsx 4.23.15
  lists `watch: Run the script and watch for changes`). docs: https://tsx.is/watch-mode
- plan — Express body parsing: a parse failure has `status` 400 and `type`
  `entity.parse.failed`, a body over `limit` has 413 and `entity.too.large`, and `req.body` is
  left `undefined` when the Content-Type does not match; `express.static(root)` serves files
  from a folder and passes on what it does not find. docs:
  https://github.com/expressjs/body-parser#errors, https://expressjs.com/en/5x/api.html#express.json,
  https://expressjs.com/en/5x/api.html#express.static
- plan — zod 4: `z.object` strips unknown keys by default (`z.strictObject` refuses them), so an
  `author` or `status` field in a body is dropped, not refused. docs: https://zod.dev/api
- plan — zod 4: an issue's `path` holds the key and then the 0-based array index (the second
  element of `favoriteNumbers` fails at `['favoriteNumbers', 1]`), so joining it with `.` gives
  `refs.3` for the fourth ref. docs: https://zod.dev/error-formatting
- plan — Scaffold tooling: `pnpm --filter <name> <cmd>` runs a command in the package with that
  name (https://pnpm.io/filtering); an `exports` subpath pattern such as `"./*": "./src/*.ts"`
  is a plain string replacement, so `@sky-brain/shared/enums` loads `src/enums.ts`
  (https://nodejs.org/api/packages.html#subpath-patterns; the spike above imported shared `.ts`
  source this way); `prettier --check` exits 1 when a file is not formatted and reads
  `.gitignore` and `.prettierignore` by default (https://prettier.io/docs/cli); `vite build`
  bundles from `<root>/index.html` into `dist` (https://vite.dev/guide/build); the tsconfig
  options named in ticket 01 are in the TypeScript reference
  (https://www.typescriptlang.org/tsconfig/); Node 22 has a global `fetch`
  (https://nodejs.org/api/globals.html#fetch); the node-postgres migrator is
  `migrate` from `drizzle-orm/node-postgres/migrator` (https://orm.drizzle.team/docs/migrations),
  given `{ migrationsFolder }` like the PGlite one in the spike.
- plan — PGlite: `PGlite.create()` awaits readiness; `dataDir` `memory://` is in memory, a
  plain path is on disk in Node; `close()` shuts it down. docs: https://pglite.dev/docs/api
- plan — HTTP 429 "MAY include a Retry-After header indicating how long to wait"; its example
  gives seconds (`Retry-After: 3600`). docs: https://www.rfc-editor.org/rfc/rfc6585#section-4
- plan — Process groups for `tools/dev-smoke.mjs`: on POSIX `spawn(..., {detached: true})` makes
  the child "the leader of a new process group", and `kill(-pgid, sig)` signals every process in
  it; on Windows `taskkill /T /F /PID <pid>` ends the process tree. docs:
  https://nodejs.org/api/child_process.html#optionsdetached,
  https://man7.org/linux/man-pages/man2/kill.2.html,
  https://learn.microsoft.com/windows-server/administration/windows-commands/taskkill
- plan — The floor guard counts a change to `tsconfig*.json`, `eslint.config.*`,
  `vitest.config.*`, `.github/workflows/*` or the `scripts` of a `package.json` as a `config`
  finding (`.feature-flow/feature_flow/floorguard.py`), so the scaffold ticket sets all of them
  up front (it carries `Floor: allow config`) and later tickets change none of them.
- user — A workspace delete keeps the workspace's earlier `audit_log` rows; the log stays
  strictly append-only (its rows hold ids, actors and actions, never titles or bodies). The
  settle ticket that asked this (12) is removed and ticket 09 builds only this answer.
- user — Claims expire after a fixed 30 days; the per-workspace override of PLAN section 6 is
  not in this feature (spec.md Scope).
- user — Workspace export and hard delete are owner-only: a human editor or viewer gets 403
  `owner_only`.
- user — Workspace delete: no `confirm` string is 400 `invalid_request` (Check order step 5); a
  present but wrong `confirm` is 400 `confirm_mismatch`, after the role check.
- user — Every entry object any route returns carries `quarantined_because` (`null` unless the
  entry is quarantined), so the 201s of ask, supersede and answer name the pattern inside their
  entry objects.
- user — One ref over 2,048 characters is 413 `too_large` with `field: "refs.<index>"` (0-based,
  for example `refs.3`).
- 01 — pnpm monorepo scaffolded (all lint/type/test/CI config fixed here); `createApp({ webDist? })` serves `/healthz`, an `/api` 404 JSON and the web shell with SPA fallback on `/{*splat}`; tsx runs the server (D13).
- 02 — Drizzle schema + generated migration and custom audit-trigger migration in `apps/server/drizzle/`; `db/client.ts` (`Db`, PGlite/Postgres, `migrateDb`, `closeDb`), `writeAudit`, `toWireEntry`/`notExpiredAt`, `normalizeGitRemote`, harness seeds; `start` uses Postgres with `DATABASE_URL`, else PGlite migrated at start, refuses production without it (D14).

## Open questions

- Which later ticket builds the per-workspace claim expiry PLAN section 6 promises ("The
  workspace can change this")? No ticket in `docs/layer-1/TICKETS.md` lists it; T3 (workspaces)
  or T8 (the web page) are the likely homes. Until then every claim gets 30 days.
- Who creates workspaces, projects and features over the API? Nothing in this feature does
  (tests seed them through the harness); the auth feature (T3) creates the first workspace, and
  projects and features need a route there or in T8. Until then `pnpm dev` has no data to
  browse.
- The dev actor header takes identity from a request header, which CLAUDE.md hard rule 2 rules
  out for real use. The brief asks for it; it is limited to `NODE_ENV=development` and
  127.0.0.1 and is replaced by the auth feature.
- How a "since" reader avoids missing late commits (Postgres sequences are not commit-ordered):
  T8's concern.
- Whether Render's Node runtime runs `corepack enable && pnpm install` in `buildCommand`: the
  deploy feature proves it.
