// Interfaces -> Settings (`readConfig`), and the edge case about production settings.
import { describe, expect, it } from "vitest";
import { readConfig } from "../../../apps/server/src/config.ts";

const GOOD_PROD = {
  NODE_ENV: "production",
  PORT: "3000",
  DATABASE_URL: "postgres://u:p@db.internal:5432/sky",
  PUBLIC_URL: "https://brain.example.com",
  BETTER_AUTH_SECRET: "s".repeat(40),
  PERMINISTER_BASE_URL: "https://perminister.example.com",
  PERMINISTER_CLIENT_ID: "made-up-perminister-client-id",
  PERMINISTER_CLIENT_SECRET: "made-up-perminister-client-secret",
};

function expectThrowsNaming(env: Record<string, string | undefined>, name: string): void {
  let message: string | undefined;
  try {
    readConfig(env);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message ?? "readConfig did not throw").toContain(name);
}

describe("readConfig in production", () => {
  // Edge: "`NODE_ENV=production` without `PUBLIC_URL`, `BETTER_AUTH_SECRET`, `PERMINISTER_BASE_URL`,
  // `PERMINISTER_CLIENT_ID` or `PERMINISTER_CLIENT_SECRET`, or `PUBLIC_URL` or `PERMINISTER_BASE_URL`
  // not HTTPS | `readConfig` throws naming the setting, so neither `start` nor the Vercel function
  // comes up (Interfaces → Settings)"
  for (const name of [
    "PUBLIC_URL",
    "BETTER_AUTH_SECRET",
    "PERMINISTER_BASE_URL",
    "PERMINISTER_CLIENT_ID",
    "PERMINISTER_CLIENT_SECRET",
  ] as const) {
    it(`throws naming ${name} when it is missing`, () => {
      expectThrowsNaming({ ...GOOD_PROD, [name]: undefined }, name);
    });

    it(`throws naming ${name} when it is an empty string`, () => {
      expectThrowsNaming({ ...GOOD_PROD, [name]: "" }, name);
    });
  }

  it("throws naming PUBLIC_URL when it is not HTTPS", () => {
    expectThrowsNaming({ ...GOOD_PROD, PUBLIC_URL: "http://brain.example.com" }, "PUBLIC_URL");
  });

  it("throws naming PERMINISTER_BASE_URL when it is not HTTPS", () => {
    expectThrowsNaming(
      { ...GOOD_PROD, PERMINISTER_BASE_URL: "http://perminister.example.com" },
      "PERMINISTER_BASE_URL",
    );
  });

  // Interfaces: "`PERMINISTER_BASE_URL` | required, `https://`, no path, query or trailing slash"
  for (const bad of [
    "https://perminister.example.com/",
    "https://perminister.example.com/app",
    "https://perminister.example.com?x=1",
  ]) {
    it(`throws naming PERMINISTER_BASE_URL for ${bad}`, () => {
      expectThrowsNaming({ ...GOOD_PROD, PERMINISTER_BASE_URL: bad }, "PERMINISTER_BASE_URL");
    });
  }

  // Interfaces: "`PUBLIC_URL` | required, `https://`, no path, query or trailing slash"
  for (const bad of [
    "https://brain.example.com/",
    "https://brain.example.com/app",
    "https://brain.example.com?x=1",
  ]) {
    it(`throws naming PUBLIC_URL for ${bad}`, () => {
      expectThrowsNaming({ ...GOOD_PROD, PUBLIC_URL: bad }, "PUBLIC_URL");
    });
  }

  // Interfaces: "`BETTER_AUTH_SECRET` | required, at least 32 characters"
  it("throws naming BETTER_AUTH_SECRET when it is shorter than 32 characters", () => {
    expectThrowsNaming({ ...GOOD_PROD, BETTER_AUTH_SECRET: "s".repeat(31) }, "BETTER_AUTH_SECRET");
  });

  it("reads a complete production configuration", () => {
    // Interfaces: "`Config` gains `publicUrl`, `betterAuthSecret`, `perministerBaseUrl`,
    // `perministerClientId` and `perministerClientSecret`"
    const config = readConfig(GOOD_PROD);
    expect(config).toMatchObject({
      publicUrl: "https://brain.example.com",
      betterAuthSecret: "s".repeat(40),
      perministerBaseUrl: GOOD_PROD.PERMINISTER_BASE_URL,
      perministerClientId: GOOD_PROD.PERMINISTER_CLIENT_ID,
      perministerClientSecret: GOOD_PROD.PERMINISTER_CLIENT_SECRET,
    });
  });
});

describe("readConfig outside production", () => {
  // Interfaces: "Outside production it never throws for these"; "an empty string reads as unset;
  // the defaults above are applied by `authFromConfig`, not `readConfig`".
  it("does not throw without the auth settings and leaves them unset", () => {
    const config = readConfig({
      NODE_ENV: "development",
      PUBLIC_URL: "",
      BETTER_AUTH_SECRET: "",
      PERMINISTER_BASE_URL: "",
      PERMINISTER_CLIENT_ID: "",
      PERMINISTER_CLIENT_SECRET: "",
    });
    expect(Object.keys(config)).toEqual(
      expect.arrayContaining([
        "publicUrl",
        "betterAuthSecret",
        "perministerBaseUrl",
        "perministerClientId",
        "perministerClientSecret",
      ]),
    );
    expect(config).toMatchObject({
      publicUrl: undefined,
      betterAuthSecret: undefined,
      perministerBaseUrl: undefined,
      perministerClientId: undefined,
      perministerClientSecret: undefined,
    });
  });

  it("does not throw for an http PUBLIC_URL or a short secret", () => {
    const config = readConfig({
      PUBLIC_URL: "http://127.0.0.1:3000",
      BETTER_AUTH_SECRET: "short",
    });
    expect(config).toMatchObject({
      publicUrl: "http://127.0.0.1:3000",
      betterAuthSecret: "short",
    });
  });

  // Interfaces: "`PERMINISTER_BASE_URL` | ... | optional"
  it("does not throw for an http PERMINISTER_BASE_URL and reads the Perminister settings", () => {
    const config = readConfig({
      PERMINISTER_BASE_URL: "http://localhost:4000",
      PERMINISTER_CLIENT_ID: "dev-client",
      PERMINISTER_CLIENT_SECRET: "dev-secret",
    });
    expect(config).toMatchObject({
      perministerBaseUrl: "http://localhost:4000",
      perministerClientId: "dev-client",
      perministerClientSecret: "dev-secret",
    });
  });
});
