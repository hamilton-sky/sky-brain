# Add device login: the device flow, approve, list and revoke

Type: task
Status: resolved
Blocked by: —
Test first: yes
Level: 3
Builder: backend
Touches: apps/server/src/devices/, apps/server/src/run-tokens/secret-token.ts, apps/server/src/run-tokens/secret-token.test.ts, apps/server/src/db/auth-schema.ts, apps/server/src/db/schema.ts, apps/server/src/db/schema.test.ts, apps/server/drizzle/, apps/server/src/app.ts, apps/server/src/app.test.ts, apps/server/src/testing/harness.ts, apps/server/src/testing/task-seeds.ts, packages/shared/src/devices.ts

Repo: sky-brain. First half of Layer 1 ticket T7, server side (spec.md § Stories "A person logs
a machine in once", § Routes, § Check order). A machine gets a long-lived device credential
through an RFC 8628-shaped flow that a person approves; revoking the device is what later
kills its run tokens (ticket 02).

- `apps/server/src/run-tokens/secret-token.ts` (new): `newSecretToken(prefix: "sbd" | "sbr")`
  (32 random bytes, base64url, `sbd_`/`sbr_` prefix), `hashSecretToken(token)` (SHA-256 hex) and
  a constant-time compare where one is needed. Ticket 02 reuses it.
- `apps/server/src/db/auth-schema.ts` (new): `deviceCodes` (id, device_code_hash unique,
  user_code unique while pending, client_name, expires_at, interval_seconds, last_polled_at,
  approved_by, device_id, issued_at, created_at). Add a nullable `secretHash` (unique) to
  `devices` in `apps/server/src/db/schema.ts` and `export * from "./auth-schema.ts"` there. Generate the
  migration with `pnpm --filter @sky-brain/server exec drizzle-kit generate`.
- `apps/server/src/devices/device-flow.ts` (new): `POST /api/device/code` and
  `POST /api/device/token`, mounted in `createApp` at `/api/device` before the `/api/v1` actor
  middleware and before the `/api` 404 fallback, with `express.json({ limit: "64kb" })`.
  User codes are 8 characters from `BCDFGHJKLMNPQRSTVWXZ`, shown `XXXX-XXXX`, matched ignoring
  case and the dash. Errors use RFC 8628's shape, 400 `{"error": "<code>"}`:
  `authorization_pending`, `slow_down` (a poll sooner than `interval_seconds` after the last),
  `expired_token` (after 900 s by the app clock), `invalid_grant` (unknown code, or its token
  already issued). On approval the next poll returns `{device_token, device_id}` once and stores
  only its hash on the device row.
- `apps/server/src/devices/devices-router.ts` (new), mounted under `/api/v1/devices`, all
  human-only (`requireHuman`): `POST /approve {user_code, name}` creates the device for the
  caller (`devices.user_id` = the human), rate limited 5 per 15 minutes per person with its own
  `createRateLimiter`; `GET /` lists the caller's devices; `POST /:id/revoke` sets `revoked_at`
  on the caller's own device (another person's is 404). Audit rows `device.approve` and
  `device.revoke` (devices have no workspace: use the nil uuid
  `00000000-0000-0000-0000-000000000000` as `workspace_id`, and say so in a comment).
- `packages/shared/src/devices.ts` (new): the zod request schemas, strict.
- Every time comparison uses `createApp({ now })`.
- `apps/server/src/testing/task-seeds.ts` (new): `withToken(server, token)` and
  `loginDevice(server, person, name)` from spec.md § Interfaces. `withToken` needs the
  harness's client builder: export `testClient` from `harness.ts` (one word), nothing else there.

Tests (`apps/server/src/devices/device-flow.test.ts`, `devices-router.test.ts`, new): each error
of the poll, the once-only token, approve as an agent (403 `humans_only`), wrong and expired
user code (404), the sixth approve in 15 minutes (429), list shows only own devices, revoke of
another person's device (404), revoke of one's own (200, `revoked_at` set).

## Not in this ticket

- Run tokens, the resolver that accepts a device token, and "revoked device's tokens fail":
  ticket 02.
- The devices page and the approval page at `verification_uri`: round two (R2-01).
- A deny route (`access_denied`): round two; an unapproved code simply expires.

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/devices` passes, covering every case
  listed under Tests.
- `pnpm --filter @sky-brain/server exec vitest run src/run-tokens/secret-token.test.ts` passes:
  two tokens differ, carry their prefix, and the stored hash never equals the token.
- All existing tests still pass, and `pnpm lint` and `pnpm typecheck` exit 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/devices
prints passed
$ pnpm --filter @sky-brain/server exec vitest run src/run-tokens/secret-token.test.ts
prints passed
$ pnpm test
$ pnpm lint
$ pnpm typecheck
```

## Reference

- spec.md § Stories, § Routes, § Check order, § Interfaces → How a test reaches the server
- map.md § Decisions so far (RFC 8628 facts)
- `apps/server/src/app.ts`, `apps/server/src/actor/require-human.ts`,
  `apps/server/src/guards/ratelimit.ts`, `apps/server/src/db/audit.ts`,
  `apps/server/drizzle/0001_audit-append-only.sql` (read-only examples)

## Answer

Work started at `43c4e4e3c46cacaefb296829f2ddfe985c08ce1b`; failing tests committed alone as `c1f47f4`.
Review round 1 fixes started at `35b2689`; their failing tests committed alone as `83ba066`.
Review round 2 fixes started at `2d900d7`; their failing tests committed alone as `1b03bdd`.

**Built**
- New: `apps/server/src/run-tokens/secret-token.ts`, `apps/server/src/db/auth-schema.ts`,
  `apps/server/src/devices/device-flow.ts`, `apps/server/src/devices/devices-router.ts`,
  `apps/server/src/devices/user-code.ts`, `apps/server/src/testing/task-seeds.ts`,
  `packages/shared/src/devices.ts`, `apps/server/drizzle/0002_device-login.sql` (+ `meta/0002_snapshot.json`,
  `_journal.json`), tests `devices/device-flow.test.ts`, `devices/devices-router.test.ts`,
  `run-tokens/secret-token.test.ts`. Round 1 fixes: `devices/window-limiter.ts` (fixed-window
  limit), `devices/device-flow-guards.test.ts` (new tests); `devices/device-flow.ts`,
  `devices/devices-router.ts`, `devices/devices-router.test.ts` and `app.ts` (`trust proxy`) changed.
- Changed: `db/schema.ts` (`devices.secretHash` nullable unique, `export * from "./auth-schema.ts"`),
  `app.ts` (`now` default, `/api/device` mount before `/api/v1`, `/api/v1/devices` after the actor
  middleware and before the `/api` 404), `testing/harness.ts` (`export` on `testClient` only; prettier
  wrapped the line), `db/schema.test.ts` (table count 8 -> 9 with `device_codes`).

**Proof**
- After the round 2 fixes (all run fresh after the last edit): `vitest run src/devices` 4 files /
  46 tests passed; secret-token 1 file / 2 tests passed; `pnpm test` exit 0 (shared 2 files / 15
  tests, server 19 files / 296 tests); `pnpm lint` exit 0; `pnpm typecheck` exit 0; acceptance
  `device-login` 15/15 passed; `node tools/dev-smoke.mjs` printed `healthz 200`. At `1b03bdd` the 8
  new tests failed for the right reasons (404 instead of 401 for the rebinding request; 200 instead
  of 429 for the spoofed X-Forwarded-For and the IPv6 /64; createApp did not throw; verification_uri
  `http://evil.example/...`; no index; `address-key.ts` missing).
- After the round 1 fixes: `vitest run src/devices` 3 files / 38 tests passed; secret-token 1 file / 2
  tests passed; `pnpm test` shared 15 passed, server 18 files / 279 tests passed, exit 0; `pnpm lint`
  exit 0; `pnpm typecheck` exit 0; acceptance `device-login.test.ts` 15/15 passed (the other files
  still fail first at routes of later tickets, createGoal / run-tokens, none on a 429).
- Round 0: `pnpm --filter @sky-brain/server exec vitest run src/devices`: 2 files, 30 tests passed. Covers
  authorization_pending, slow_down, expired_token (at exactly 900 s by the app clock), invalid_grant
  (unknown code and after the token was issued), token once and only its hash stored, approve as
  agent 403 `humans_only`, wrong / expired / already-approved user code 404, sixth approve 429 with
  `Retry-After`, list only own, revoke of another's device 404 (row unchanged), revoke own 200 with
  `revoked_at` = app clock, audit rows `device.approve`/`device.revoke` with the nil workspace,
  strict bodies, non-uuid id 400.
- `pnpm --filter @sky-brain/server exec vitest run src/run-tokens/secret-token.test.ts`: 1 file, 2 tests passed.
- `pnpm test`: shared 15 passed, server 17 files / 271 tests passed, exit 0. `pnpm lint` exit 0,
  `pnpm typecheck` exit 0.
- Not required, but run: acceptance `device-login.test.ts` 15/15 passed.

**Decisions**
- User code uniqueness: a partial unique index on `user_code WHERE device_id IS NULL` ("pending" =
  not yet approved); code creation uses `onConflictDoNothing` on that index and retries up to 5 times.
  Approve looks up `user_code = ? AND device_id IS NULL AND expires_at > now`. Expired, never-approved
  rows keep their user code reserved (2.56e10 space; no cleanup job).
- Expiry is `now >= expires_at` (approve and poll agree). Poll order: invalid_grant (unknown or
  issued) -> expired_token -> slow_down -> authorization_pending / issue. Every poll that reaches the
  slow_down check updates `last_polled_at`, including a slow_down poll. `interval_seconds` is not
  raised on slow_down (RFC: the client adds 5 s).
- The device code is 32 random bytes base64url, stored only as SHA-256 hex. The device token is
  `sbd_…`; only its hash goes to `devices.secret_hash`. Issue is a conditional `UPDATE … WHERE
  issued_at IS NULL` in the poll transaction, so the token is handed out once.
- Flow errors are written directly as `{"error": "<code>"}`; the router has its own error middleware
  that turns body-parser errors (broken JSON, over 64 KB) into `invalid_request` (400/413) in that
  shape. A wrong `grant_type` is `unsupported_grant_type` (RFC 6749); other schema failures are
  `invalid_request`.
- Approve: `requireHuman` (router-wide) -> limiter (fixed window: 5 per 900 s from the person's first
  approve, clock = app `now`; see Review fixes) -> `validate` -> 404 lookup. The limiter sets `Retry-After` itself before
  throwing the 429 `HttpError`. A user code that cannot be normalized to 8 letters is 404, not 400.
- Revoke of an already-revoked own device answers 200 with the existing `revoked_at` and writes no
  second audit row.
- `verification_uri` is `<protocol>://<host>/devices/approve` from the request; the page is R2-01.
- No constant-time compare was added: tokens are found by hash lookup in the database, so no stored
  secret is compared in app code.

**Shortcuts taken**
- Purge of expired codes runs as one `DELETE` on each `/code` call with no index on `expires_at`;
  the table stays small because of the per-address limit and the purge. Add an index (or a timed
  job) if the table ever grows to many thousands of rows.
- The per-address limits key on `req.ip` with `trust proxy` 1 (one Render proxy hop). If Render
  ever puts a second hop in front, every caller behind one edge shares a bucket (not spoofable,
  just coarser); set the hop count then. In `pnpm dev`, with no proxy, a caller can choose its own
  `X-Forwarded-For` and so its own bucket: dev only.
- The approve limiter is in memory per server instance (like `createRateLimiter` everywhere); a
  second instance doubles the budget. Upgrade when sky-brain runs more than one instance.
- `verification_uri` echoes the request's Host header (scheme now from the proxy); see Review fix 5.
- An approved code whose client never polls within the 60 s grace leaves a device with no token in
  the person's list; the person can revoke it. Hide token-less devices if that confuses people.
- No migration test proving existing `devices` rows survive 0002: the migration only adds a nullable
  column and a new table. Worth adding if a later migration rewrites `devices`.
- Revoke is not behind the general per-actor write rate limit of Check order step 5; no general
  limiter is mounted in the app yet, and the ticket asked only for approve's.

**Review fixes** (round 1)
1. Anonymous `/api/device/code` growth: per client address token buckets, before the body parser,
   answering 429 `{"error":"rate_limited"}` with `Retry-After` (`/code`: burst 60, then 1 per 15 s;
   `/token`: burst 60, then 1 per second, a client polls every 5 s). `app.set("trust proxy", 1)` in
   `app.ts` so `req.ip` is the client behind Render's proxy and a caller cannot pick its bucket with
   its own `X-Forwarded-For`. Each `/code` deletes never-approved codes 900 s after they expired,
   which also frees their user codes (the pending index no longer holds them forever). Approved rows
   are kept (they link a device). Tests: 61st code / poll from one address 429 while another goes on;
   purge at exactly expiry + 900 s, approved row kept, purged code polls `invalid_grant`.
2. Approve limit is now a fixed 15-minute window per person (`devices/window-limiter.ts`; it returns
   the same `TakeResult` as `createRateLimiter`). Test: 5 approves, the 6th at minute 3 is 429 with
   `Retry-After: 720`, still 429 at 14:59, allowed at 15:00.
3. Poll locks the device row (`FOR UPDATE`, the same lock revoke takes) and answers `invalid_grant`
   when `revoked_at` is set; no hash is stored. Test: approve, revoke, poll -> `invalid_grant`,
   `secret_hash` null.
4. An approved code still issues its token up to 60 s (`ISSUE_GRACE_SECONDS`) after expiry; a
   pending code still expires at 900 s. Tests: approved at 899 s, polled at 901 s -> token; approved,
   first polled at 960 s -> `expired_token`.
5. Partly fixed. The scheme now comes from `X-Forwarded-Proto` through `trust proxy` (test:
   `https` behind the proxy). The host is still the request's `Host`: a configured public base URL
   has to be read in `config.ts` and passed by `server.ts`, both outside this ticket's Touches. The
   value only goes back to the same anonymous caller that sent the Host header and the response is
   a POST answer (not cached), so it cannot steer another person. Proposed for R2-01, which adds the
   page at that URL and so needs the base URL anyway.

**Review fixes** (round 2)
1. Fixed in `app.ts`. `createApp` has a new `trustProxyHops` option. It defaults to 1, or to 0 when
   `devActorHeader` is on, and `createApp` throws if it is above 0 while `devActorHeader` is on.
   `pnpm dev` therefore trusts no `X-Forwarded-*` header, so `req.hostname` is the raw `Host` again
   and D15's localhost check holds. `server.ts` needed no change, because it already passes
   `devActorHeader`. I left the guard in `actor/middleware.ts` (outside Touches) alone: the
   createApp invariant closes the hole for every caller of `createApp`.
   Tests in `app.test.ts`:
   - Refused case: `Host: rebound.example` with `X-Forwarded-Host: localhost` and `X-Dev-Actor`
     gets 401 `dev_actor_disabled`.
   - Allowed case: `Host: localhost:<port>` still reaches the route.
   - `createApp` throws for `devActorHeader` with `trustProxyHops: 1`, and for -1 and 1.5.
2. Dev half fixed by 1. With the dev actor header on, 60 requests with different `X-Forwarded-For`
   values share one bucket and the 61st gets 429 (test). The hop count is now an option
   (`trustProxyHops`, with a test that 2 hops picks the second entry from the right).
   Render's real chain is **not verified**: I have no Render deploy here. What I found:
   - On https://community.render.com/t/what-number-of-proxies-sit-in-front-of-an-express-app-deployed-on-render/35981
     one user found that 3 hops gave the client address.
   - On https://community.render.com/t/accessing-client-ips-in-a-node-express-app/36282 another
     user took the second-to-last entry and noted that Render passes caller-sent entries through.
   - Neither thread has a staff answer, and Render's docs say nothing on this.
   The default stays 1 because it fails closed. If Render really adds more hops, every client
   shares one bucket per edge address, which is coarse but not spoofable. Too high a number would
   instead let a caller pick its own bucket. Recording the hop count in `docs/DECISIONS.md` is
   outside Touches (ticket 10 owns the decisions). Before launch, someone must read the real
   `X-Forwarded-For` of one request on the Render service and set the hop count. Setting it from
   the environment needs `config.ts`/`server.ts`, which are also outside Touches.
3. Fixed. The new `devices/address-key.ts` keys an IPv6 address by its /64 (`a:b:c:d::/64`), an
   IPv4-mapped one as its IPv4 address, and leaves IPv4 unchanged. `perAddress` in `device-flow.ts`
   uses it.
   - Unit tests in `address-key.test.ts` cover compressed and expanded forms, an embedded IPv4 tail,
     a zone, and a non-address.
   - Route test: 60 codes from 60 addresses of one /64 make the 61st 429, while another /64 goes on.
4. Partly fixed. `createApp` has a new `publicBaseUrl` option, checked to be a bare http(s) origin
   (it throws otherwise). When it is set, `verification_uri` is built from it whatever the `Host`,
   `X-Forwarded-Host` or `X-Forwarded-Proto` say (tests). When it is unset, the old behaviour
   stays. That fallback uses `req.get("host")`, the raw `Host` header, never `X-Forwarded-Host`,
   so the finding's "can now come from X-Forwarded-Host" does not apply to this line. `server.ts`
   does not pass the option yet, because reading `PUBLIC_BASE_URL` belongs in `config.ts` and
   `server.ts` (outside Touches). R2-01, which serves the page at that URI, should wire it up.
5. Fixed. A partial index `device_codes_pending_expires_at_idx` on `expires_at WHERE device_id IS
   NULL` (`auth-schema.ts`, migration `0003_device-codes-expiry-index.sql`, generated by drizzle-kit)
   matches the purge's filter. The test in `db/schema.test.ts` reads the index from `pg_indexes`.
   The migration only adds an index, so it loses no data.

**For later tickets**
- 02: hash a presented `sbd_` token with `hashSecretToken` and look up `devices.secret_hash` (unique);
  reject when `revoked_at` is set. A device whose token was never issued has `secret_hash` null.
  `createApp` now has a local `now` and `db`; pass `now` to new routers. `withToken` and
  `loginDevice` are in `testing/task-seeds.ts` (loginDevice uses `client_name: "test"`).
- Device audit rows use workspace `00000000-0000-0000-0000-000000000000`.
- `createApp` now takes `trustProxyHops` (default 1, 0 with `devActorHeader`) and `publicBaseUrl`.
  Whoever wires config (R2-01 or a deploy ticket) should read `PUBLIC_BASE_URL` and the verified
  Render hop count in `config.ts` and pass both from `server.ts`. Ticket 10 may record the hop count
  in `docs/DECISIONS.md` once it is checked on Render.
- Migrations now go to 0003; whoever merges brain-core renumbers after it.

## Review findings (round 1, pair review)

I reviewed cloud-task-board ticket 01 (device login), commits 43c4e4e..17c5d71, which is HEAD, so no later commits were left out. I read the ticket as it was at the base commit and the diff with the tasks folder held back. The `## Answer` section never reached me. I ran only read-only commands. Following the conductor's notes, I did not re-run the Done when commands. No files were left behind.

As a hostile caller I probed these inputs: `client_name`, `grant_type`, `device_code`, `user_code`, `name`, the `:id` in the revoke path, the actor and Authorization header, the Host header, body size and content type, the app clock, and two people approving the same code at once. Several holes are closed and need no change:
- **Identity:** it comes from the actor, and the strict schemas refuse a caller-sent `device_id` or user id.
- **Concurrent approval:** two approvals of one code are serialized by `FOR UPDATE` plus `device_id IS NULL`, so the second gets 404.
- **Token issued once:** the token is issued only once, guarded by `issuedAt` under a row lock.
- **Hashes only:** only hashes are stored.
- **Another person's device:** revoking it gives 404.

QUALITY
1. major apps/server/src/devices/device-flow.ts: anyone can call `POST /api/device/code` with no credential and no limit, and every call inserts a `device_codes` row that is never deleted. A hostile caller can grow the production database without bound for free. Expired codes that were never approved also keep their user code reserved in `device_codes_pending_user_code_idx` (the index covers `device_id IS NULL` and ignores expiry). - Add a per-IP token bucket on `/api/device/*` (`createRateLimiter` keyed on `req.ip`, with `trust proxy` set for Render). Also delete or ignore expired pending rows, for example purge expired codes on insert or add `expires_at` handling to the pending check. The spec says nothing on this, so the conductor may move it to followups.md if the architect agrees.
2. major apps/server/src/devices/devices-router.ts: the approve limiter is a token bucket (capacity 5, refill 5/900 s), so it allows about 9 approvals in 15 minutes: 5 at once, then 1 every 3 minutes. The spec (lines 75 and 425) says more than 5 in 15 minutes gets 429. The test only fires 6 calls at once, so it cannot catch this. - Use a fixed or sliding 15-minute window of 5 per person, or refill a full bucket only after 15 minutes. Add a test where the 6th approval, at minute 3, gets 429.
3. minor apps/server/src/devices/device-flow.ts: if a device is revoked after approval but before its first poll, the poll still mints a `sbd_` token and stores its hash on the revoked device row. - Return `invalid_grant` when `devices.revoked_at` is set, so that ticket 02's resolver is not the only guard.
4. minor apps/server/src/devices/device-flow.ts: the expiry check runs before the approval check. A code approved at second 899 and polled at second 901 gets `expired_token` and leaves a device with no token in the person's list. - Either issue the token for an approved code inside a short grace period, or do not list or create the device until the token is issued.
5. minor apps/server/src/devices/device-flow.ts: `verification_uri` is built from `req.protocol` and the request's `Host` header. `trust proxy` is not set, so behind Render it comes out as `http://`, and the host is whatever the caller sent. - Build it from a configured public base URL.

REVIEW: FAIL

Range reviewed: 43c4e4e3c46cacaefb296829f2ddfe985c08ce1b..17c5d71 (END is HEAD, so no later commits were left out). I read the ticket only as it stood at the base commit and left the tickets folder out of the diff, so the author's Answer never reached me. The ticket's Status line changed from open to resolved. My commands left no files behind, and git status is clean.

SPEC
- `pnpm --filter @sky-brain/server exec vitest run src/devices` passes, covering every case listed under Tests: MET (conductor). I also re-ran it together with the secret-token test: 3 files and 32 tests passed. The test names cover every case the ticket lists:
  - each poll error: authorization_pending, slow_down, expired_token by the app clock, and invalid_grant
  - the device token is handed out only once
  - an agent approving gets 403 humans_only
  - a wrong user code and an expired user code each get 404
  - the sixth approve within 15 minutes gets 429
  - the list shows only the caller's own devices
  - revoking another person's device gets 404
  - revoking one's own device gets 200 with revoked_at set
- `pnpm --filter @sky-brain/server exec vitest run src/run-tokens/secret-token.test.ts` passes (two tokens differ, each carries its prefix, the stored hash never equals the token): MET (conductor). It passed in my re-run too, and the test checks all three things.
- All existing tests pass (`pnpm test`): MET (conductor)
- `pnpm lint` exits 0: MET (conductor)
- `pnpm typecheck` exits 0: MET (conductor)
- acceptance tests for this ticket: I ran `pnpm exec vitest run --root plans/cloud-task-board/acceptance device-login`: 1 file and 15 tests passed. The acceptance failures the conductor reported are in the files for later tickets: goals, run tokens, claim, report, isolation and the happy path.
- scope: OK. Every changed file is in the ticket's Touches list (the devices files, secret-token and its test, auth-schema, schema and its test, the drizzle migration and meta files, app.ts, the one-word `testClient` export in harness.ts, task-seeds and shared devices.ts), plus the flow's own map.md and learnings.md lines. `apps/server/src/devices/user-code.ts` sits inside the `apps/server/src/devices/` folder the ticket names. `app.test.ts` is listed in Touches but is unchanged, which is allowed. Nothing in the diff falls under `Not in this ticket`: there are no run tokens, no resolver, no pages and no deny route.
- test first: OK. Commit c1f47f4 adds the three test files and no production code. The conductor saw them fail at that commit, and without the production change they would fail because the routes and modules they import do not exist yet.

REVIEW: PASS

## Review findings (round 2, pair review)

Range reviewed: 43c4e4e3c46cacaefb296829f2ddfe985c08ce1b..8f05bbc. That is HEAD, so no later commits were left out. I read the ticket as it stood at the base commit, plus the round 1 review findings (lines 196 onward of the working copy). The `## Answer` section never reached me. I re-ran `vitest run src/devices src/run-tokens/secret-token.test.ts`: 4 files and 40 tests passed. My commands left no files behind, and git status is clean.

Inputs I probed as a hostile caller:
- **Device code request:** `client_name`.
- **Token poll:** `grant_type` and `device_code`.
- **Approve:** `user_code` and `name`.
- **Revoke:** the `:id` path parameter.
- **Headers:** the actor and Authorization headers, `Host`, `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`.
- **Body:** size and content type.
- **App clock:** expiry and the grace period.
- **Races:** concurrent approve, revoke and poll.

These are closed and need no change:
- **Identity:** it comes from the actor, and the strict schemas refuse a caller-sent device id or user id.
- **Locking:** the poll locks device_codes, then devices. Revoke locks devices only, so the two cannot deadlock.
- **One token per code:** the token is issued once, guarded by `issuedAt` under a lock.
- **Revoked before first poll:** this gets `invalid_grant`.
- **Hashes only:** only hashes are stored, and `secretHash` is never sent back.
- **Another person's device:** revoking it gives 404.
- **Approve limit:** it is now a true fixed window of 5 per 15 minutes, and it runs after `requireHuman`.
- **Async errors:** Express 5.3 passes errors thrown in async handlers to the error handler.

QUALITY
1. major apps/server/src/app.ts: `app.set("trust proxy", 1)` is set for every environment, and that reopens the DNS-rebinding hole that D15 closed. With trust proxy on, Express 5 takes `req.hostname` from the caller's `X-Forwarded-Host` header (express/lib/request.js:418-430, which trusts the first hop). The dev-actor guard in apps/server/src/actor/middleware.ts:61 checks `req.hostname`. A page on a rebinding domain is same-origin to the browser, so it can send `X-Dev-Actor` together with `X-Forwarded-Host: localhost`, pass the guard, and act as any actor, a human included, against `pnpm dev`. I confirmed that Express with trust proxy 1 returns `hostname=localhost` for a request with `Host: evil.example` and `X-Forwarded-Host: localhost`. No test covers this. Two fixes:
   - Set `trust proxy` only in production, or make it an option of `createApp`.
   - Make the dev-actor guard read the raw `Host` header (`req.get("host")`, port stripped) instead of `req.hostname`.
   Add a refused-case test: `X-Dev-Actor` with `X-Forwarded-Host: localhost` and a non-loopback `Host` must get 401 `dev_actor_disabled`.
2. minor apps/server/src/app.ts / apps/server/src/devices/device-flow.ts: the per-address limits on `/api/device/*` only work if exactly one proxy hop sits in front of the app.
   - Without a proxy (dev, or any non-Render host), a caller can set `X-Forwarded-For` to any value and get a fresh bucket on every request.
   - Nobody has checked that Render adds exactly one hop. If Cloudflare sits in front of it too, `req.ip` becomes a shared edge address and many real clients share one budget of 60.
   Check Render's real `X-Forwarded-For` chain, and record the hop count in a decision.
3. minor apps/server/src/devices/device-flow.ts: the limiter keys on the full `req.ip`. A caller with an IPv6 /64 has about 2^64 keys, so `/code` inserts are still effectively unlimited for them. The purge only bounds the table to about 30 minutes of that rate. Key IPv6 addresses by their /64 prefix.
4. minor apps/server/src/devices/device-flow.ts: `verification_uri` is still built from the request's host. With trust proxy on, that host can now come from `X-Forwarded-Host` as well as `Host`, and the caller sets both. Today this only affects the caller's own response, but the approval page in R2-01 will rely on this value. Build it from a configured public base URL.
5. minor apps/server/src/devices/device-flow.ts and apps/server/src/db/auth-schema.ts: every `POST /api/device/code` runs a DELETE filtered on `expires_at`, and that column has no index, so each anonymous request scans the whole table. Add an index on `expires_at` (or a partial index where `device_id IS NULL`), or purge on a timer.

REVIEW: FAIL

I reviewed round 2 of cloud-task-board ticket 01 (device login), range 43c4e4e3c46cacaefb296829f2ddfe985c08ce1b..8f05bbc. END is HEAD, so no later commits were left out. I read the ticket as it stood at the base commit, plus the round 1 review findings section, which I read on its own. I kept the tickets folder out of the diff, so the author's `## Answer` never reached me. The ticket's Status changed from open to resolved. I ran only read-only commands and the device-login acceptance file. git status is clean and nothing was left behind.

Round 1 findings, as they stand in the code:
- **Unlimited anonymous /code calls:** each client address now has a limit on `/code` and on `/token`, with `trust proxy` set to 1 in app.ts. Never-approved codes are deleted on `/code` 900 s after they expire.
- **Approve limit too loose:** approve now uses a fixed 15-minute window (`window-limiter.ts`). A new test sends the 6th approve at minute 3 and expects 429 with Retry-After 720.
- **Device revoked before its first poll:** the poll now returns `invalid_grant`, and the device row is locked during that check.
- **Code approved in its last second:** an approved code gets a 60 s grace period after it expires.
- **`verification_uri` scheme and host:** the scheme now comes from the proxy because of `trust proxy`. The host is still taken from the request. That is for the quality pass to judge, not this spec pass.

SPEC
- `pnpm --filter @sky-brain/server exec vitest run src/devices` passes, covering every case listed under Tests: MET (conductor). The test names cover every listed case: each poll error, the token handed out once, an agent approving gets 403 humans_only, wrong and expired user codes get 404, the sixth approve in 15 minutes gets 429, the list shows only the caller's own devices, revoking another person's device gets 404, and revoking one's own gets 200 with revoked_at set.
- `pnpm --filter @sky-brain/server exec vitest run src/run-tokens/secret-token.test.ts` passes (two tokens differ, each carries its prefix, the stored hash never equals the token): MET (conductor). The test asserts all three.
- All existing tests pass (`pnpm test`): MET (conductor)
- `pnpm lint` exits 0: MET (conductor)
- `pnpm typecheck` exits 0: MET (conductor)
- acceptance tests for this ticket: I ran `pnpm exec vitest run --root plans/cloud-task-board/acceptance device-login` and 1 file with 15 tests passed. The failures the conductor reported come from files for later tickets, for example `createGoal` in run-tokens.test.ts.
- scope: OK. Every changed file is in Touches: the devices folder (now also `window-limiter.ts` and `device-flow-guards.test.ts`), secret-token and its test, auth-schema, schema and its test, the drizzle migration and meta files, app.ts (now also `trust proxy`, added for a round 1 finding), the one-word `testClient` export in harness.ts, task-seeds and shared devices.ts. The only other changes are the flow's own map.md and learnings.md lines. Nothing in the diff falls under `Not in this ticket`: no run tokens, no resolver, no pages and no deny route.
- test first: OK. c1f47f4 (round 1) and 83ba066 (round 2) add tests only, and the code follows in later commits. The conductor saw c1f47f4 fail. The round 2 tests check the new limiter, the purge, the grace period, the revoked-device case and the proxy scheme, and they would fail against the round 1 code. For example, the old token bucket would let the minute-3 approve through.

REVIEW: PASS
