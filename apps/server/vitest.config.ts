import { defineConfig } from "vitest/config";

// Each test file boots a PGlite (about 3 s, slower under parallel load).
export default defineConfig({
  test: {
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
