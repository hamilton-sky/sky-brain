import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Folder order inside apps/server/src (docs/PACKAGES.md): db, then kernel (actor, guards, scope,
// http, run-tokens), then memory, board (tasks, projects, devices) and approvals (approvals,
// push). A folder imports only folders before it. Tests may also use the app harness.
const serverLayers = [
  ["db"],
  ["actor", "guards", "scope", "http", "run-tokens"],
  ["memory"],
  ["tasks", "projects", "devices"],
  ["approvals", "push"],
];
const serverOnly = [
  "agents",
  "auth",
  "mcp",
  "testing",
  "config",
  "app",
  "server",
];
const layerRules = serverLayers.map((layer, i) => {
  const later = [...serverLayers.slice(i + 1).flat(), ...serverOnly];
  return {
    files: layer.map((dir) => `apps/server/src/${dir}/**/*.ts`),
    ignores: ["**/*.test.ts", "**/tests/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: later.flatMap((dir) => [`**/${dir}/*`, `**/${dir}.ts`]),
              message:
                "Folder order (docs/PACKAGES.md): import only folders that come earlier.",
            },
          ],
        },
      ],
    },
  };
});

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "plans/**",
      "scripts/**",
      ".feature-flow/**",
      ".claude/**",
      "apps/server/drizzle/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["apps/web/src/**/*.tsx"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["apps/web/public/sw.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: [
      "**/*.test.ts",
      "apps/server/src/testing/**",
      "apps/server/src/mcp/test/**",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  ...layerRules,
);
