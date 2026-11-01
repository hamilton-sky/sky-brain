# Scaffold the pnpm monorepo with CI, render.yaml and the healthz server

Type: task
Status: resolved
Blocked by: —
Test first: no
Level: 3
Floor: allow config
Touches: package.json, pnpm-workspace.yaml, pnpm-lock.yaml, .gitignore, .prettierignore, .prettierrc.json, eslint.config.js, tsconfig.base.json, .github/workflows/ci.yml, render.yaml, tools/dev-smoke.mjs, CLAUDE.md, README.md, docs/DECISIONS.md, apps/server/, apps/web/, packages/shared/

Build the T1 scaffold from nothing (the repo has only docs and the feature-flow install). This
ticket creates every lint, test, type and CI config the plan needs, because the floor guard
treats a later change to any of them as weakening the bar; it carries `Floor: allow config` for
that reason only.

Root:
- `package.json`: private, `"type": "module"`, `"packageManager": "pnpm@10.28.0"`,
  `"engines": {"node": ">=22.12.0 <23"}` (Render reads it and wants an upper bound; Vitest 5
  needs ^22.12). Scripts exactly: `lint` = `eslint . && prettier --check .`, `typecheck` =
  `pnpm -r --if-present typecheck`, `test` = `pnpm -r --if-present test`, `build` =
  `pnpm -r --if-present build`, `dev` = `pnpm --filter @sky-brain/web build && pnpm --filter @sky-brain/server dev`.
  Root devDependencies hold the shared tooling at the versions in map.md: `typescript` ~6.0.3,
  `vitest`, `eslint`, `@eslint/js`, `typescript-eslint`, `prettier`, `globals`, `@types/node`
  (22.x). The acceptance command (`pnpm exec vitest run --root plans/brain-core/acceptance`)
  needs `vitest` at the root.
- `pnpm-workspace.yaml`: `apps/*`, `packages/*`; allow esbuild's install script
  (`onlyBuiltDependencies: [esbuild]`; pnpm 10 runs no dependency install script that is not
  listed there, map.md).
- Type-aware lint fails on a TypeScript file that no tsconfig includes, so every package's
  `tsconfig.json` includes its `src` and its root `*.ts` config files (`vite.config.ts`,
  `vitest.config.ts`, and the `drizzle.config.ts` a later ticket adds).
- `tsconfig.base.json`: `strict`, `module`/`moduleResolution` `nodenext`,
  `allowImportingTsExtensions`, `noEmit`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`,
  `skipLibCheck`, `types: ["node"]` (TypeScript 6 defaults `types` to `[]`).
- `eslint.config.js` (flat): `@eslint/js` recommended and typescript-eslint
  `recommendedTypeChecked` with `projectService`; type checking off for `.js`/`.mjs`; ignores
  `**/dist/**`, `**/node_modules/**`, `plans/**`, `scripts/**`, `.feature-flow/**`,
  `.claude/**`, `apps/server/drizzle/**`. In `**/*.test.ts` and `apps/server/src/testing/**`,
  turn off `@typescript-eslint/no-explicit-any` and the `@typescript-eslint/no-unsafe-*` rules
  (tests read untyped JSON bodies; see spec.md Interfaces, `TestResponse.body: any`).
- `.prettierrc.json` (`{}` is fine) and `.prettierignore`: `pnpm-lock.yaml`, `**/dist/`,
  `*.md`, `plans/`, `docs/`, `scripts/`, `.feature-flow/`, `.claude/`. The existing markdown is
  not Prettier-formatted, and feature-flow checks its own files' hashes, so they must not be
  reformatted.
- `.gitignore`: `node_modules/`, `dist/`, `.pglite/`, `*.tsbuildinfo`, `.env`, `.env.*`,
  `coverage/`.

`packages/shared` (`@sky-brain/shared`): consumed as TypeScript source, with
`"exports": {"./*": "./src/*.ts"}` so each later ticket adds its own file without a barrel.
Add `src/enums.ts` (new) with the PLAN section 5 value lists as const arrays and types: `KINDS`,
`STATUSES`, `SOURCES`, `AUTHOR_KINDS`, `ROLES`, and a test pinning them to the spec's lists.
Scripts `typecheck` (`tsc --noEmit`) and `test` (`vitest run`). Its `tsconfig.json` includes
`src` and `*.ts`. Add `zod` (4.6.7) as a dependency now, here and in `apps/server`: later tickets
put their zod schemas in this package and the server imports zod types, and the tickets that
write schemas do not list these `package.json` files.

`apps/server` (`@sky-brain/server`): Express 5 (`express`, `@types/express`), `tsx` as a
dependency (it runs the server in production too: spec.md Decisions), `@sky-brain/shared`
(`workspace:*`). Scripts: `typecheck`, `test` (`vitest run`), `dev` (`tsx watch src/dev.ts`),
`start` (`tsx src/main.ts`). `tsconfig.json` includes `src` and `*.ts`, so a later
`drizzle.config.ts` needs no tsconfig change. `vitest.config.ts` sets `hookTimeout` to
60_000 and `testTimeout` to 30_000, because each test file will boot a PGlite (about 3 s each,
measured; slower under parallel load). Files:
- `src/app.ts` (new): `createApp(options: { webDist?: string })` returns the Express app: `GET /healthz`
  → 200 `{"ok":true}`; any unknown `/api/...` path → 404 JSON `{"error":{"code":"not_found",...}}`;
  everything else serves `webDist` (default: `apps/web/dist`, resolved from the module's own
  location) with an SPA fallback to `index.html` for other GET paths (Express 5 wildcard
  syntax `/*splat`), or a plain 404 when the build is missing.
- `src/config.ts` (new): `readConfig(env)`, pure: `port` from `PORT` (default 3000).
- `src/server.ts` (new): `start(config)` listens and returns the server; `src/main.ts` calls it with
  `readConfig(process.env)`; `src/dev.ts` (new) sets `process.env.NODE_ENV ??= "development"` and then
  imports and runs the same start (no shell `NODE_ENV=` prefix, so it works on Windows too).
- Tests, in `apps/server/src/app.test.ts` (new): `GET /healthz answers 200`, `GET / serves
  the web build` (with a temp `webDist` holding an `index.html`) and `unknown /api path answers
  404 JSON`.

`apps/web` (`@sky-brain/web`): Vite 8 + React 19 + `@vitejs/plugin-react`, one `index.html`,
`src/main.tsx` (new) rendering an empty shell (the product name and nothing else). Scripts
`build` (`vite build`) and `typecheck` (`tsc --noEmit`); no `test` script (no tests yet).

`tools/dev-smoke.mjs` (new) (plain Node, no dependencies): picks a free port, starts `pnpm dev` with
`PORT` set and `PGLITE_DATA_DIR=memory://` (used once the database lands), polls
`http://127.0.0.1:<port>/healthz` every 500 ms for up to 120 s, prints `healthz 200` when it
answers 200, then stops the whole process tree (POSIX: spawn detached and kill the group;
Windows: `taskkill /T /F`) and exits 0; on timeout or another status it prints why and exits 1.

`.github/workflows/ci.yml` (new): on push and pull_request; `actions/checkout`, then pnpm
through `pnpm/action-setup@v6` with no `version` (it reads `packageManager`), then Node 22
through `actions/setup-node@v7` with `cache: pnpm` (it needs pnpm installed first, so this order),
then `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (map.md, CI
actions line).

`render.yaml`: one `type: web`, `runtime: node` service named `sky-brain` on a paid plan
(`0.5c-512mb`; PLAN section 12 says free instances sleep), `buildCommand`
`corepack enable && pnpm install --frozen-lockfile && pnpm build`, `startCommand`
`pnpm --filter @sky-brain/server start`, `healthCheckPath: /healthz`, envVars `NODE_ENV=production`
and `DATABASE_URL` `fromDatabase` (`property: connectionString`); one database `sky-brain-db`
(`plan: 0.1c-256mb`, `databaseName: skybrain`, `user: skybrain`, `postgresMajorVersion: "18"`, the major PGlite 0.5.14 runs).
Keys as in map.md (Render Blueprint line). Nothing is deployed.

Docs: fill the `## Commands` section of `CLAUDE.md` (replace "To be filled in by ticket T1."
with the commands in spec.md Interfaces → Commands); change README's Status to say Layer 1's
offline core is being built and login is not in yet; add a decision to `docs/DECISIONS.md`
(next free number) recording TypeScript 6.0 (typescript-eslint does not support 7) and tsx as
the production runtime, with what was rejected.

## Not in this ticket

- The database, migrations and the PGlite harness: the database ticket (02).
- The actor middleware, `/api/v1` routes and the dev actor header: later tickets.
- Any web page content beyond the empty shell: T8, out of this feature.
- Deploying `render.yaml`: the deploy feature.

## Done when

- On a clean tree with dependencies installed, `pnpm lint && pnpm typecheck && pnpm test` exits
  0 (the gate's Build step has already run `pnpm install --frozen-lockfile`).
- The server tests cover the healthz, web-shell and unknown-API cases and pass, and their names
  contain the `prints` lines of the check block below.
- `node tools/dev-smoke.mjs` prints `healthz 200` and exits 0.
- `.github/workflows/ci.yml` (new) runs install with the frozen lockfile, lint, typecheck and test;
  `render.yaml` has the `/healthz` health check and the database connection string.
- `CLAUDE.md` no longer says "To be filled in by ticket T1".

```check
# The conductor runs this block before review.
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
$ pnpm --filter @sky-brain/server exec vitest run --reporter=verbose
prints GET /healthz answers 200
prints GET / serves the web build
$ node tools/dev-smoke.mjs
prints healthz 200
$ cat .github/workflows/ci.yml
prints pnpm install --frozen-lockfile
prints pnpm lint
prints pnpm typecheck
prints pnpm test
$ cat render.yaml
prints healthCheckPath: /healthz
prints connectionString
$ grep -c "To be filled in by ticket T1" CLAUDE.md
exit nonzero
prints 0
```

## Reference

- spec.md § Goal and the bar, § Decisions, § Interfaces (Commands, How a test reaches the server)
- map.md § Decisions so far (versions, TypeScript 6 defaults, Render keys, floor guard config)
- docs/PLAN.md sections 11 and 12 (read-only); docs/layer-1/TICKETS.md T1 (read-only)
- CLAUDE.md "Code rules" (400-line files, shared schemas in `packages/shared`)

## Answer

Work started at commit `0c6037d3c48d5200fe5d013678118dded62314d1`.

**Built**
- Root: `package.json` (scripts exactly as the ticket says; root devDependencies `typescript ~6.0.3`,
  `vitest 5.0.5`, `eslint 10.14.0`, `@eslint/js 10.0.1`, `typescript-eslint 8.72.1`,
  `prettier 3.9.10`, `globals 17.14.0`, `@types/node 22.20.5`), `pnpm-workspace.yaml`
  (`onlyBuiltDependencies: [esbuild]`), `pnpm-lock.yaml`, `.gitignore`, `.prettierignore`,
  `.prettierrc.json`, `eslint.config.js`, `tsconfig.base.json`.
- `packages/shared`: `package.json` (`exports: {"./*": "./src/*.ts"}`, zod 4.6.7), `tsconfig.json`,
  `src/enums.ts`, `src/enums.test.ts`.
- `apps/server`: `package.json` (express 5.3.0, tsx 4.23.15, zod 4.6.7, `@sky-brain/shared`
  `workspace:*`, `@types/express` 5.0.6), `tsconfig.json`, `vitest.config.ts` (hook 60 s,
  test 30 s), `src/app.ts`, `src/config.ts`, `src/server.ts`, `src/main.ts`, `src/dev.ts`,
  `src/app.test.ts`.
- `apps/web`: `package.json` (react/react-dom 19.3.1, vite 8.3.5, @vitejs/plugin-react 6.1.2,
  @types/react(-dom) 19.3.0), `tsconfig.json` (`jsx: react-jsx`), `vite.config.ts`, `index.html`,
  `src/main.tsx` (renders `<h1>sky-brain</h1>` only).
- `tools/dev-smoke.mjs`, `.github/workflows/ci.yml`, `render.yaml`.
- Docs: `CLAUDE.md` Commands section filled; `README.md` Status rewritten; `docs/DECISIONS.md`
  D13 (TypeScript 6.0 and tsx in production, with rejected options).

**Proof** (all run fresh after the last edit, after `rm -rf apps/web/dist` and
`pnpm install --frozen-lockfile`)
- `pnpm lint && pnpm typecheck && pnpm test`: exit 0. ESLint clean, "All matched files use
  Prettier code style!", three packages typecheck Done, shared 5/5 tests, server 5/5 tests.
- `pnpm --filter @sky-brain/server exec vitest run --reporter=verbose`: 5 passed, including
  `GET /healthz answers 200`, `GET / serves the web build`, `unknown /api path answers 404 JSON`
  (plus the SPA fallback and the plain 404 with no build).
- `node tools/dev-smoke.mjs`: printed `sky-brain listening on port <n>` then `healthz 200`,
  exit 0; afterwards no tsx, vite or pnpm process was left running.
- `cat .github/workflows/ci.yml`: has `pnpm install --frozen-lockfile`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test`. `cat render.yaml`: has `healthCheckPath: /healthz` and
  `property: connectionString`.
- `grep -c "To be filled in by ticket T1" CLAUDE.md`: prints `0`, exit 1.

**Decisions**
- The SPA fallback route is `/{*splat}`, not `/*splat`: in Express 5 `/*splat` needs at least one
  path segment, so `GET /` with no web build fell through to Express's HTML "Cannot GET /"
  instead of the plain 404. `{...}` makes the wildcard optional; it is still the Express 5 named
  wildcard syntax.
- `index.html` is served with `res.sendFile` on each request (not checked once at start), so a
  build made after the server starts is picked up; a missing file answers `404 Not found`
  (text/plain).
- `/api` 404 is `app.use("/api", ...)`, placed before `express.static`, so no static file or SPA
  fallback can answer an `/api` path.
- `start(config)` returns a `Promise<Server>` that resolves once listening (rejects on a listen
  error). `dev.ts` sets `NODE_ENV` and then loads `config.ts`/`server.ts` with dynamic `import()`,
  so the env is set before any module that reads it is evaluated.
- `readConfig` refuses a `PORT` that is not a whole number from 0 to 65535 (throws).
- `tsconfig.base.json` leaves `target` at TypeScript 6's default (es2025). The web tsconfig only
  adds `jsx: react-jsx`; TypeScript's default lib already includes the DOM.
- ESLint adds browser globals for `apps/web/src/**/*.tsx` and Node globals elsewhere.
- CI uses `actions/checkout@v5`, `pnpm/action-setup@v6` (no `version`), `actions/setup-node@v7`
  with `node-version: 22`, `cache: pnpm`.

**Shortcuts taken**
- The SPA fallback answers `index.html` for any unknown GET, including a missing
  `/assets/*.js`; fine for an empty shell, worth a 404 for asset paths once the web app (T8)
  ships real assets.
- `dev-smoke.mjs` stops the tree with SIGTERM, so pnpm prints an `ELIFECYCLE ... SIGTERM` line
  after `healthz 200`; harmless noise, the script's own exit code is 0.

**For later tickets**
- `createApp(options: AppOptions = {})` in `apps/server/src/app.ts` with `AppOptions { webDist? }`;
  03 extends it. Keep `/healthz` and the `/api` 404 before `express.static` and the fallback.
- `start(config)` in `server.ts` calls `createApp()` with no options; 02 must pass the db (and
  later the dev actor setting) through it. It listens on all interfaces today; the 127.0.0.1-only
  bind for the dev header is 02/03's to add.
- `Config` is `{ port }` only; 02 adds `DATABASE_URL` / `PGLITE_DATA_DIR`.
- Every package tsconfig already includes `src` and `*.ts`, so `drizzle.config.ts` needs no
  config change. Every package that runs Vitest must have its own `test` script for `pnpm test`.
- Acceptance tests still cannot run: `apps/server/src/testing/harness.ts` and `src/db/schema.ts`
  arrive with 02.
