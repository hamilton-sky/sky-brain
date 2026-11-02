# Add device login: the device flow, approve, list and revoke

Type: task
Status: open
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

**Built**
- New: `apps/server/src/run-tokens/secret-token.ts`, `apps/server/src/db/auth-schema.ts`,
  `apps/server/src/devices/device-flow.ts`, `apps/server/src/devices/devices-router.ts`,
  `apps/server/src/devices/user-code.ts`, `apps/server/src/testing/task-seeds.ts`,
  `packages/shared/src/devices.ts`, `apps/server/drizzle/0002_device-login.sql` (+ `meta/0002_snapshot.json`,
  `_journal.json`), tests `devices/device-flow.test.ts`, `devices/devices-router.test.ts`,
  `run-tokens/secret-token.test.ts`.
- Changed: `db/schema.ts` (`devices.secretHash` nullable unique, `export * from "./auth-schema.ts"`),
  `app.ts` (`now` default, `/api/device` mount before `/api/v1`, `/api/v1/devices` after the actor
  middleware and before the `/api` 404), `testing/harness.ts` (`export` on `testClient` only; prettier
  wrapped the line), `db/schema.test.ts` (table count 8 -> 9 with `device_codes`).

**Proof**
- `pnpm --filter @sky-brain/server exec vitest run src/devices`: 2 files, 30 tests passed. Covers
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
- Approve: `requireHuman` (router-wide) -> limiter (5 per 900 s, `refillPerSecond` 5/900, keyed by the
  person, clock = app `now`) -> `validate` -> 404 lookup. The limiter sets `Retry-After` itself before
  throwing the 429 `HttpError`. A user code that cannot be normalized to 8 letters is 404, not 400.
- Revoke of an already-revoked own device answers 200 with the existing `revoked_at` and writes no
  second audit row.
- `verification_uri` is `<protocol>://<host>/devices/approve` from the request; the page is R2-01.
- No constant-time compare was added: tokens are found by hash lookup in the database, so no stored
  secret is compared in app code.

**Shortcuts taken**
- The approve limiter is in memory per server instance (like `createRateLimiter` everywhere); a
  second instance doubles the budget. Upgrade when sky-brain runs more than one instance.
- `verification_uri` echoes the request's Host header; it only goes back to the same anonymous caller.
  Upgrade to a configured public base URL when R2-01 adds the page.
- No migration test proving existing `devices` rows survive 0002: the migration only adds a nullable
  column and a new table. Worth adding if a later migration rewrites `devices`.
- Revoke is not behind the general per-actor write rate limit of Check order step 5; no general
  limiter is mounted in the app yet, and the ticket asked only for approve's.

**For later tickets**
- 02: hash a presented `sbd_` token with `hashSecretToken` and look up `devices.secret_hash` (unique);
  reject when `revoked_at` is set. A device whose token was never issued has `secret_hash` null.
  `createApp` now has a local `now` and `db`; pass `now` to new routers. `withToken` and
  `loginDevice` are in `testing/task-seeds.ts` (loginDevice uses `client_name: "test"`).
- Device audit rows use workspace `00000000-0000-0000-0000-000000000000`.

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
