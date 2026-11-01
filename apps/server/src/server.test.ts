import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { start } from "./server.ts";

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe("start", () => {
  it("refuses to start in production without DATABASE_URL", async () => {
    await expect(
      start({
        port: 0,
        databaseUrl: undefined,
        pgliteDataDir: "memory://",
        nodeEnv: "production",
      }),
    ).rejects.toThrow(/DATABASE_URL/);
  });

  it("opens and migrates PGlite when DATABASE_URL is unset, and answers /healthz", async () => {
    const server = await start({
      port: 0,
      databaseUrl: undefined,
      pgliteDataDir: "memory://",
      nodeEnv: "test",
    });
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(res.status).toBe(200);
    } finally {
      await close(server);
    }
  });
});
