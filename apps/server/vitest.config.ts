import { configDefaults, defineConfig } from "vitest/config";

// Each test file boots a PGlite (about 3 s, slower under parallel load).
// `*.pg.test.ts` needs a real Postgres and runs with `test:pg` (vitest.pg.config.ts).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/*.pg.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
