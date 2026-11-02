# Learnings: cloud-task-board

Things a fresh worker would otherwise waste time rediscovering: a command that works, a
trap, a quirk of the environment. Append one or two lines, newest last, tagged with your
ticket number. Never edit or delete another line. Keep it short; a human prunes it.

- (01) `pnpm exec prettier --write` is not idempotent on some chained calls; run it twice (or `pnpm lint`) before committing test files. drizzle-kit generate takes `--name <tag>` for the migration file name.
