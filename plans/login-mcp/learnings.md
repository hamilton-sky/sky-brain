# Learnings: login-mcp

Things a fresh worker would otherwise waste time rediscovering: a command that works, a
trap, a quirk of the environment. Append one or two lines, newest last, tagged with your
ticket number. Never edit or delete another line. Keep it short; a human prunes it.

- (02) `pnpm add @better-auth/mcp@1.7.15` pulls `@better-auth/oauth-provider` 1.7.18 with peer warnings; the exact direct pin of `@better-auth/oauth-provider` 1.7.15 fixes it. The `auth generate` CLI prints a "Drizzle schema mismatch" error while generating; it still writes the file.
