# Scaffold the pnpm monorepo with CI, render.yaml and the healthz server

Type: task
Status: open
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
