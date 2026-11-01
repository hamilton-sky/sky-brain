// Interfaces -> Settings (`readConfig`), and the edge case about production settings.
import { describe, expect, it } from "vitest";
import { readConfig } from "../../../apps/server/src/config.ts";

const GOOD_PROD = {
  NODE_ENV: "production",
  PORT: "3000",
  DATABASE_URL: "postgres://u:p@db.internal:5432/sky",
  PUBLIC_URL: "https://brain.example.com",
  BETTER_AUTH_SECRET: "s".repeat(40),
  GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-client-secret-value",
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
  // Edge: "`NODE_ENV=production` without `PUBLIC_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID` or
  // `GOOGLE_CLIENT_SECRET`, or `PUBLIC_URL` not HTTPS | `readConfig` throws naming the setting, so
  // the server never starts (Interfaces → Settings)"
  for (const name of [
    "PUBLIC_URL",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
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
    const config = readConfig({
      ...GOOD_PROD,
      BOOTSTRAP_OWNER_EMAIL: "Boss@Example.com",
      ALLOWED_EMAILS: " Ann@Example.com, ,ben@example.com ,",
    });
    expect(config).toMatchObject({
      publicUrl: "https://brain.example.com",
      betterAuthSecret: "s".repeat(40),
      googleClientId: GOOD_PROD.GOOGLE_CLIENT_ID,
      googleClientSecret: GOOD_PROD.GOOGLE_CLIENT_SECRET,
      bootstrapOwnerEmail: "boss@example.com",
      allowedEmails: ["ann@example.com", "ben@example.com"],
    });
  });
});

describe("readConfig outside production", () => {
  // Interfaces: "Outside production it never throws for these"; "an empty string reads as unset;
  // the defaults above are applied by `start`, not `readConfig`".
  it("does not throw without the auth settings and leaves them unset", () => {
    const config = readConfig({
      NODE_ENV: "development",
      PUBLIC_URL: "",
      BETTER_AUTH_SECRET: "",
      ALLOWED_EMAILS: "",
    });
    expect(Object.keys(config)).toEqual(
      expect.arrayContaining([
        "publicUrl",
        "betterAuthSecret",
        "googleClientId",
        "googleClientSecret",
        "bootstrapOwnerEmail",
        "allowedEmails",
      ]),
    );
    expect(config).toMatchObject({
      publicUrl: undefined,
      betterAuthSecret: undefined,
      googleClientId: undefined,
      googleClientSecret: undefined,
      bootstrapOwnerEmail: undefined,
      allowedEmails: [],
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

  // Interfaces: "`ALLOWED_EMAILS` | optional, comma separated" — "each entry trimmed and
  // lower-cased, empty entries dropped; the bootstrap email is lower-cased too"
  it("trims and lower-cases ALLOWED_EMAILS and BOOTSTRAP_OWNER_EMAIL and drops empty entries", () => {
    const config = readConfig({
      BOOTSTRAP_OWNER_EMAIL: "Shammai@Example.COM",
      ALLOWED_EMAILS: "A@x.com,, b@X.com ,",
    });
    expect(config.allowedEmails).toEqual(["a@x.com", "b@x.com"]);
    expect(config.bootstrapOwnerEmail).toBe("shammai@example.com");
  });
});
