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
