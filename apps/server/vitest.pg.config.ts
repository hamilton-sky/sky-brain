import { defineConfig } from "vitest/config";

// The real-Postgres tests (`pnpm test:pg`): they need TEST_DATABASE_URL.
export default defineConfig({
  test: {
    include: ["src/**/*.pg.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
