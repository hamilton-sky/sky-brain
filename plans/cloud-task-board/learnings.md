# Learnings: cloud-task-board

Things a fresh worker would otherwise waste time rediscovering: a command that works, a
trap, a quirk of the environment. Append one or two lines, newest last, tagged with your
ticket number. Never edit or delete another line. Keep it short; a human prunes it.

- (01) `pnpm exec prettier --write` is not idempotent on some chained calls; run it twice (or `pnpm lint`) before committing test files. drizzle-kit generate takes `--name <tag>` for the migration file name.
- (01) `app.set("trust proxy", 1)` is on: a test can act as another client address by sending `x-forwarded-for` through `server.anonymous.request(...)`; the device-flow limiters key on `req.ip`, so loops of `/api/device/code` from 127.0.0.1 share one burst of 60 per server.
- (01) `X-Forwarded-*` is trusted only when `devActorHeader` is off (`trustProxyHops`, app.ts); a test that fakes client addresses with `x-forwarded-for` must use a server without the dev actor header. To send a raw `Host` header use `node:http` `request`, not fetch (see app.test.ts `raw`).
