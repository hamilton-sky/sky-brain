import { describe, expect, it } from "vitest";
import { readConfig } from "./config.ts";

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
    });
    expect(config).toEqual({
      port: 4000,
      databaseUrl: "postgres://u:p@localhost:5432/db",
      pgliteDataDir: "memory://",
      nodeEnv: "production",
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
