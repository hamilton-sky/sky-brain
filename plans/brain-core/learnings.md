# Learnings: brain-core

Things a fresh worker would otherwise waste time rediscovering: a command that works, a
trap, a quirk of the environment. Append one or two lines, newest last, tagged with your
ticket number. Never edit or delete another line. Keep it short; a human prunes it.

- (01) Express 5: `app.get("/*splat")` does not match `GET /`; use `"/{*splat}"` for a catch-all that includes the root.
- (01) Registry access works here (`npm view`, `pnpm install`); pnpm prints an update banner you can ignore. Run `pnpm exec prettier --write .` after writing new files: `pnpm lint` runs `prettier --check`.
