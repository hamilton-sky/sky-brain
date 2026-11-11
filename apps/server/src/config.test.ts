import { describe, expect, it } from "vitest";
import { devActorHeaderEnabled, readConfig } from "./config.ts";

// Made-up values: never a real client secret.
const productionAuth = {
  PUBLIC_URL: "https://brain.example.com",
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
  PERMINISTER_BASE_URL: "https://perminister.example.com",
  PERMINISTER_APP_CLIENT_ID: "test-client-id",
  PERMINISTER_APP_CLIENT_SECRET: "test-client-secret",
};

const productionAuthConfig = {
  publicUrl: "https://brain.example.com",
  betterAuthSecret: "test-secret-0123456789abcdef0123456789",
  perministerBaseUrl: "https://perminister.example.com",
  perministerClientId: "test-client-id",
  perministerClientSecret: "test-client-secret",
};

function production(overrides: Record<string, string | undefined>) {
  return readConfig({
    NODE_ENV: "production",
    ...productionAuth,
    ...overrides,
  });
}

describe("readConfig", () => {
  it("defaults the port to 3000 and PGlite to .pglite under apps/server", () => {
    const config = readConfig({});
    expect(config.port).toBe(3000);
    expect(config.databaseUrl).toBeUndefined();
    expect(config.pgliteDataDir).toMatch(/apps[/\\]server[/\\]\.pglite$/);
  });

  it("reads DATABASE_URL, PGLITE_DATA_DIR and NODE_ENV", () => {
    const config = readConfig({
      PORT: "4000",
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      PGLITE_DATA_DIR: "memory://",
      NODE_ENV: "production",
      ...productionAuth,
    });
    expect(config).toEqual({
      port: 4000,
      databaseUrl: "postgres://u:p@localhost:5432/db",
      pgliteDataDir: "memory://",
      nodeEnv: "production",
      ...productionAuthConfig,
    });
  });

  it("treats an empty DATABASE_URL as unset", () => {
    expect(readConfig({ DATABASE_URL: "" }).databaseUrl).toBeUndefined();
  });

  it("refuses a PORT that is not a whole number up to 65535", () => {
    expect(() => readConfig({ PORT: "abc" })).toThrow(/PORT/);
    expect(() => readConfig({ PORT: "70000" })).toThrow(/PORT/);
  });
});

describe("readConfig auth settings", () => {
  it("reads the auth settings", () => {
    expect(production({})).toMatchObject(productionAuthConfig);
    expect(
      readConfig({ NODE_ENV: "development", ...productionAuth }),
    ).toMatchObject(productionAuthConfig);
  });

  it("leaves the auth settings unset outside production and treats empty as unset", () => {
    const config = readConfig({ NODE_ENV: "development", PUBLIC_URL: "" });
    expect(config.publicUrl).toBeUndefined();
    expect(config.betterAuthSecret).toBeUndefined();
    expect(config.perministerBaseUrl).toBeUndefined();
    expect(config.perministerClientId).toBeUndefined();
    expect(config.perministerClientSecret).toBeUndefined();
    expect(
      readConfig({ PUBLIC_URL: "http://localhost:3000/x" }).publicUrl,
    ).toBe("http://localhost:3000/x");
  });

  it("refuses production without PUBLIC_URL", () => {
    expect(() => production({ PUBLIC_URL: undefined })).toThrow(/PUBLIC_URL/);
    expect(() => production({ PUBLIC_URL: "" })).toThrow(/PUBLIC_URL/);
  });

  it("refuses a PUBLIC_URL that is not https in production", () => {
    for (const bad of [
      "http://brain.example.com",
      "https://brain.example.com/",
      "https://brain.example.com/app",
      "https://brain.example.com?x=1",
      "brain.example.com",
    ]) {
      expect(() => production({ PUBLIC_URL: bad }), bad).toThrow(/PUBLIC_URL/);
    }
  });

  it("refuses production without BETTER_AUTH_SECRET", () => {
    expect(() => production({ BETTER_AUTH_SECRET: undefined })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
    let message = "";
    try {
      production({ BETTER_AUTH_SECRET: "short-secret-value" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/BETTER_AUTH_SECRET/);
    expect(message).not.toContain("short-secret-value");
  });

  it("prefers PERMINISTER_APP_CLIENT_ID and PERMINISTER_APP_CLIENT_SECRET", () => {
    const config = production({
      PERMINISTER_CLIENT_ID: "old-client-id",
      PERMINISTER_CLIENT_SECRET: "old-client-secret",
    });
    expect(config.perministerClientId).toBe("test-client-id");
    expect(config.perministerClientSecret).toBe("test-client-secret");
  });

  it("falls back to PERMINISTER_CLIENT_ID and PERMINISTER_CLIENT_SECRET", () => {
    for (const unset of [undefined, ""]) {
      const config = production({
        PERMINISTER_APP_CLIENT_ID: unset,
        PERMINISTER_APP_CLIENT_SECRET: unset,
        PERMINISTER_CLIENT_ID: "old-client-id",
        PERMINISTER_CLIENT_SECRET: "old-client-secret",
      });
      expect(config.perministerClientId, String(unset)).toBe("old-client-id");
      expect(config.perministerClientSecret, String(unset)).toBe(
        "old-client-secret",
      );
    }
  });

  it("refuses production without the Perminister client", () => {
    expect(() => production({ PERMINISTER_BASE_URL: undefined })).toThrow(
      /PERMINISTER_BASE_URL/,
    );
    for (const [newName, oldName] of [
      ["PERMINISTER_APP_CLIENT_ID", "PERMINISTER_CLIENT_ID"],
      ["PERMINISTER_APP_CLIENT_SECRET", "PERMINISTER_CLIENT_SECRET"],
    ] as const) {
      for (const unset of [undefined, ""]) {
        let message = "";
        try {
          production({ [newName]: unset, [oldName]: unset });
        } catch (err) {
          message = (err as Error).message;
        }
        expect(message, newName).toMatch(
          new RegExp(
            `^${newName} \\(or the older ${oldName}\\) must be set when NODE_ENV is production; refusing to start$`,
          ),
        );
        expect(message, newName).toContain(`or the older ${oldName}`);
        expect(message).not.toContain("test-client-secret");
      }
    }
  });

  it("refuses a PERMINISTER_BASE_URL that is not https in production", () => {
    for (const bad of [
      "http://perminister.example.com",
      "https://perminister.example.com/",
      "https://perminister.example.com/api",
    ]) {
      expect(() => production({ PERMINISTER_BASE_URL: bad }), bad).toThrow(
        /PERMINISTER_BASE_URL/,
      );
    }
  });

  it("names the first missing setting", () => {
    expect(() => readConfig({ NODE_ENV: "production" })).toThrow(/PUBLIC_URL/);
  });
});

describe("devActorHeaderEnabled", () => {
  it("is on only when NODE_ENV is exactly development", () => {
    expect(devActorHeaderEnabled({ NODE_ENV: "development" })).toBe(true);
  });

  it("is off in production, in test, when unset and for anything else", () => {
    expect(devActorHeaderEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(devActorHeaderEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(devActorHeaderEnabled({})).toBe(false);
    expect(devActorHeaderEnabled({ NODE_ENV: "" })).toBe(false);
    expect(devActorHeaderEnabled({ NODE_ENV: "Development" })).toBe(false);
    expect(devActorHeaderEnabled({ NODE_ENV: "development " })).toBe(false);
  });
});
