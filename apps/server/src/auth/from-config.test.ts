import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.ts";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "sky-brain-auth-"));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

function devConfig(pgliteDataDir: string): Config {
  return {
    port: 0,
    databaseUrl: undefined,
    pgliteDataDir,
    nodeEnv: "development",
    publicUrl: "http://localhost:3000",
    betterAuthSecret: undefined,
    perministerBaseUrl: undefined,
    perministerClientId: undefined,
    perministerClientSecret: undefined,
  };
}

/** One `pnpm dev` process: fresh modules, open the dev database, sign a JWT, close it. */
async function startSignAndStop(dataDir: string): Promise<string> {
  vi.resetModules();
  const { createPgliteDb, migrateDb, closeDb } =
    await import("../db/client.ts");
  const { authFromConfig } = await import("./from-config.ts");
  const db = await createPgliteDb(dataDir);
  try {
    await migrateDb(db);
    const { instance } = authFromConfig(devConfig(dataDir), db);
    const { token } = await instance.api.signJWT({
      body: { payload: { sub: "dev-user" } },
    });
    return token;
  } finally {
    await closeDb(db);
  }
}

describe("authFromConfig", () => {
  it("keeps signing JWTs after a dev restart on the same database", async () => {
    const dataDir = join(dir, "pglite");
    const before = await startSignAndStop(dataDir);
    const after = await startSignAndStop(dataDir);
    expect(before.split(".")).toHaveLength(3);
    expect(after.split(".")).toHaveLength(3);
  });
});
