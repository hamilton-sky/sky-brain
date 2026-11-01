# Learnings: brain-core

Things a fresh worker would otherwise waste time rediscovering: a command that works, a
trap, a quirk of the environment. Append one or two lines, newest last, tagged with your
ticket number. Never edit or delete another line. Keep it short; a human prunes it.

- (01) Express 5: `app.get("/*splat")` does not match `GET /`; use `"/{*splat}"` for a catch-all that includes the root.
- (01) Registry access works here (`npm view`, `pnpm install`); pnpm prints an update banner you can ignore. Run `pnpm exec prettier --write .` after writing new files: `pnpm lint` runs `prettier --check`.
- (02) Close stdin when running long commands here (`< /dev/null`): a stray `cat > file` with no input hangs the shell. Vitest hides `console.log` of passing tests unless `--reporter=verbose`.
- (02) Drizzle wraps Postgres errors in `DrizzleQueryError`; assert on `err.cause.message` (constraint name or trigger text), e.g. `rejects.toMatchObject({ cause: { message: expect.stringMatching(/fk_name/) } })`. `drizzle-kit generate` printing "No schema changes" proves schema.ts and the SQL agree.
- (03) `tsx` runs a scratch `.ts` file outside a package as CJS (no top-level await); name it `.mts`. Route code gets the actor with `actorOf(req)` from `src/actor/middleware.ts`, never from the body.
- (04) gitleaks v8.28.0 config is reachable with `curl -sS https://raw.githubusercontent.com/gitleaks/gitleaks/v8.28.0/config/gitleaks.toml`; its regexes port to JS as is (write `\x60` as a backtick). Prettier rewraps new test files: run `prettier --write` before the test-only commit.
- (04) A regex-timing test should grow the input (1 KB, 2 KB, … 16 KB) and assert per size: a catastrophic pattern then fails in about a second instead of hanging vitest (a synchronous regex ignores the test timeout).
