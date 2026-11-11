# Read Perminister's own variable names for the app client

Type: task
Status: resolved
Blocked by: 06
Test first: yes
Level: 3
Touches: apps/server/src/config.ts, apps/server/src/config.test.ts, CLAUDE.md, docs/CONNECT.md, docs/PLAN.md

Added by the repair (shammai, 2026-11-11). Ticket 07 stopped at its manual half: when Perminister
creates the production app client it hands out the Vercel variables as
`PERMINISTER_APP_CLIENT_ID` and `PERMINISTER_APP_CLIENT_SECRET`, and those names cannot be
changed. Perminister's other client app (Visitoring) reads the same two names plus
`PERMINISTER_BASE_URL`. sky-brain's `apps/server/src/config.ts` reads only
`PERMINISTER_CLIENT_ID` and `PERMINISTER_CLIENT_SECRET`, so a production start with Perminister's
variables refuses to come up. shammai approved this fix.

1. `apps/server/src/config.ts`, `readConfig`: read the client id from
   `PERMINISTER_APP_CLIENT_ID`, falling back to `PERMINISTER_CLIENT_ID`; read the secret from
   `PERMINISTER_APP_CLIENT_SECRET`, falling back to `PERMINISTER_CLIENT_SECRET`. An empty value
   counts as unset (as today), so an empty new name falls through to the old one. When both
   are set, the new name wins. The `Config` field names (`perministerClientId`,
   `perministerClientSecret`) do not change, so `apps/server/src/auth/from-config.ts`, `apps/server/src/testing/auth-harness.ts`
   and every caller stay as they are.
2. `checkProductionAuth`: the two messages name the new names:
   `PERMINISTER_APP_CLIENT_ID must be set` and `PERMINISTER_APP_CLIENT_SECRET must be set`
   (still followed by `when NODE_ENV is production; refusing to start`, and still never echoing a
   value). The order of the checks does not change. `PERMINISTER_BASE_URL` stays as it is,
   required in production with no default.
3. `apps/server/src/config.test.ts`, written first: the production fixture uses the new names;
   the allowed and refused cases are
   - a test titled `prefers PERMINISTER_APP_CLIENT_ID and PERMINISTER_APP_CLIENT_SECRET`: both
     new and old names set to different values, the config holds the new ones;
   - a test titled `falls back to PERMINISTER_CLIENT_ID and PERMINISTER_CLIENT_SECRET`: only the
     old names set (also with the new names set to `""`), a production `readConfig` succeeds and
     the config holds the old values;
   - the existing `refuses production without the Perminister client` test: with neither name
     for the id (or the secret) set, the error names `PERMINISTER_APP_CLIENT_ID`
     (`PERMINISTER_APP_CLIENT_SECRET`); the message never contains the secret's value.
4. Docs, in the same commit (CLAUDE.md "Docs stay in sync"):
   - `CLAUDE.md` Environment list: the Perminister bullet names `PERMINISTER_BASE_URL`,
     `PERMINISTER_APP_CLIENT_ID`, `PERMINISTER_APP_CLIENT_SECRET` (the names Perminister hands
     out), and says the older `PERMINISTER_CLIENT_ID` / `PERMINISTER_CLIENT_SECRET` are still read
     as a fallback.
   - `docs/CONNECT.md`: the section 2 table rows and the local `.env` example use the new names
     (the secret still left empty); one sentence under the table says Perminister hands these
     names out and the older `PERMINISTER_CLIENT_ID` / `PERMINISTER_CLIENT_SECRET` still work
     as a fallback; the Troubleshooting example reads
     `PERMINISTER_APP_CLIENT_ID must be set when NODE_ENV is production; refusing to start`.
     Section 1 step 3 may say the variables come from Perminister already named. Leave
     `## Verified` alone (ticket 07 fills it).
   - `docs/PLAN.md` section 12: the auth settings bullet names `PERMINISTER_APP_CLIENT_ID` and
     `PERMINISTER_APP_CLIENT_SECRET`, with the old names as the fallback.

Keep the old names named once in `docs/CONNECT.md` and `docs/PLAN.md` (the fallback sentence):
resolved ticket 06's checks count them there.

## Not in this ticket

- A default for `PERMINISTER_BASE_URL` (Visitoring defaults to `https://www.perminister.com`):
  not part of the approved fix; production still requires it.
- `spec.md`: the bar does not change. Its settings rows name the old names, which are still read.
- The stale acceptance suite (`plans/login-mcp/acceptance`, still on the Google settings): it
  does not name these variables; it is already a follow-up in `followups.md`.
- Setting the variables in Vercel, deploying, the manual client checks: ticket 07.

## Done when

- The config tests pass, including the new allowed (fallback, preference) and refused cases:
  `pnpm --filter @sky-brain/server exec vitest run src/config.test.ts --reporter=verbose` exits 0
  and prints both new test titles.
- The production errors name the new names:
  `grep -q 'PERMINISTER_APP_CLIENT_ID must be set' apps/server/src/config.ts && grep -q 'PERMINISTER_APP_CLIENT_SECRET must be set' apps/server/src/config.ts && echo errors-ok`
  prints `errors-ok`.
- `CLAUDE.md`, `docs/CONNECT.md` and `docs/PLAN.md` each name both new variables:
  `grep -l 'PERMINISTER_APP_CLIENT_ID' CLAUDE.md docs/CONNECT.md docs/PLAN.md | wc -l` prints `3`
  and `grep -l 'PERMINISTER_APP_CLIENT_SECRET' CLAUDE.md docs/CONNECT.md docs/PLAN.md | wc -l`
  prints `3`.
- The CONNECT.md troubleshooting example names the new id:
  `grep -q 'PERMINISTER_APP_CLIENT_ID must be set when NODE_ENV is production' docs/CONNECT.md && echo trouble-ok`
  prints `trouble-ok`.
- No secret value is written down, under either name:
  `grep -cE 'PERMINISTER_(APP_)?CLIENT_SECRET *= *[^ <]' docs/CONNECT.md || true` prints `0`.
- Ticket 06's variable count still holds (the old names stay as the fallback):
  `grep -oE 'PUBLIC_URL|BETTER_AUTH_SECRET|DATABASE_URL|MIGRATION_DATABASE_URL|MIGRATION_DATABASE_ROLE|PERMINISTER_BASE_URL|PERMINISTER_CLIENT_ID|PERMINISTER_CLIENT_SECRET' docs/CONNECT.md | sort -u | wc -l`
  prints `8`, and `grep -q 'PERMINISTER_CLIENT_SECRET' docs/PLAN.md && echo plan-ok` prints `plan-ok`.
- Everything else still passes: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/config.test.ts --reporter=verbose
prints falls back to PERMINISTER_CLIENT_ID and PERMINISTER_CLIENT_SECRET
$ pnpm --filter @sky-brain/server exec vitest run src/config.test.ts --reporter=verbose
prints prefers PERMINISTER_APP_CLIENT_ID and PERMINISTER_APP_CLIENT_SECRET
$ grep -q 'PERMINISTER_APP_CLIENT_ID must be set' apps/server/src/config.ts && grep -q 'PERMINISTER_APP_CLIENT_SECRET must be set' apps/server/src/config.ts && echo errors-ok
prints errors-ok
$ grep -l 'PERMINISTER_APP_CLIENT_ID' CLAUDE.md docs/CONNECT.md docs/PLAN.md | wc -l
prints 3
$ grep -l 'PERMINISTER_APP_CLIENT_SECRET' CLAUDE.md docs/CONNECT.md docs/PLAN.md | wc -l
prints 3
$ grep -q 'PERMINISTER_APP_CLIENT_ID must be set when NODE_ENV is production' docs/CONNECT.md && echo trouble-ok
prints trouble-ok
$ grep -cE 'PERMINISTER_(APP_)?CLIENT_SECRET *= *[^ <]' docs/CONNECT.md || true
prints 0
$ grep -oE 'PUBLIC_URL|BETTER_AUTH_SECRET|DATABASE_URL|MIGRATION_DATABASE_URL|MIGRATION_DATABASE_ROLE|PERMINISTER_BASE_URL|PERMINISTER_CLIENT_ID|PERMINISTER_CLIENT_SECRET' docs/CONNECT.md | sort -u | wc -l
prints 8
$ grep -q 'PERMINISTER_CLIENT_SECRET' docs/PLAN.md && echo plan-ok
prints plan-ok
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- The user's report (shammai, 2026-11-11): Perminister's variable names, Visitoring's use of them.
- spec.md § Interfaces → Settings and the production-settings edge case; ticket 02 (wrote
  `readConfig`), ticket 06 (wrote `docs/CONNECT.md`).
- `apps/server/src/config.ts`, `apps/server/src/config.test.ts`, CLAUDE.md "Environment",
  `docs/CONNECT.md` sections 1, 2, Local development and Troubleshooting, `docs/PLAN.md` section 12.

## Answer

Work started at `4d63cdc05dd00b06717f75796a9692ebb4d353ee`. Test-only commit: `27df0c5`
(`test(login-mcp): 08 failing test`); at that commit the config tests failed 4 of 16 (the
preference test got `old-client-id`; the fallback-with-`""` and refused cases got
`PERMINISTER_CLIENT_ID must be set ...`).

- **Built**:
  - `apps/server/src/config.ts`: `readConfig` reads `PERMINISTER_APP_CLIENT_ID ||
    PERMINISTER_CLIENT_ID || undefined` and the same for the secret; `checkProductionAuth` messages
    now `PERMINISTER_APP_CLIENT_ID must be set` / `PERMINISTER_APP_CLIENT_SECRET must be set`, same
    order, no value echoed. `Config` field names unchanged.
  - `apps/server/src/config.test.ts`: fixture uses the new names; new tests `prefers
    PERMINISTER_APP_CLIENT_ID and PERMINISTER_APP_CLIENT_SECRET` and `falls back to
    PERMINISTER_CLIENT_ID and PERMINISTER_CLIENT_SECRET` (new names `undefined` and `""`);
    `refuses production without the Perminister client` now unsets both names (as `undefined` and
    as `""`) and checks the message starts with the new name and never contains the secret value.
  - `CLAUDE.md` Environment bullet; `docs/CONNECT.md` section 1 step 3, section 2 table rows plus
    a fallback paragraph under the table, local `.env` example (secret still empty), Troubleshooting
    example; `docs/PLAN.md` section 12 auth bullet. `## Verified` untouched.
- **Proof** (all run after the last edit):
  - `vitest run src/config.test.ts --reporter=verbose`: exit 0, 16 passed, prints both new titles.
  - errors grep printed `errors-ok`.
  - `grep -l PERMINISTER_APP_CLIENT_ID ... | wc -l` printed `3`; same for `_SECRET` printed `3`.
  - troubleshooting grep printed `trouble-ok`.
  - secret grep printed `0`.
  - ticket 06 variable count printed `8`; PLAN grep printed `plan-ok`.
  - `pnpm lint && pnpm typecheck && pnpm test` exit 0: Prettier clean, tsc clean, server 23 files
    / 301 tests passed, shared 2 files / 15 tests passed.
- **Decisions**:
  - `||` chain, so an empty new name falls through to the old one and an empty old one to
    `undefined`, matching the existing "empty counts as unset" rule.
  - The old names appear once in each of CONNECT.md and PLAN.md, in the fallback sentence, as the
    ticket asks; the table and `.env` example name only the new ones.
  - The test fix after the test commit (`as const` on the tuple list) was for `tsc` only; Vitest
    does not typecheck, so the test commit still failed for the right reason.
- **Shortcuts taken**: none.
- **For later tickets**:
  - 07: set `PERMINISTER_APP_CLIENT_ID` / `PERMINISTER_APP_CLIENT_SECRET` in Vercel as
    Perminister hands them out; a missing one now logs the `PERMINISTER_APP_` name.
  - `plans/login-mcp/followups.md` 06 item 2 (quote secrets in the `.env` example) still applies,
    now to `PERMINISTER_APP_CLIENT_SECRET`.
