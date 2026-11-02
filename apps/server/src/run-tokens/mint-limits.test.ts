// Run tokens (cloud-task-board ticket 02, round 2 review): mint is rate-limited per actor and
// device (spec.md Check order step 5), a device's expired run tokens are purged when it mints,
// and the bearer scheme is matched without regard to case, so an `sbr_`/`sbd_` token never
// falls through.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runTokens } from "../db/schema.ts";
import { testClient } from "../testing/harness.ts";
import { mintRunToken, withToken } from "../testing/task-seeds.ts";
import { hashSecretToken } from "./secret-token.ts";
import {
  device,
  expectError,
  useRunTokenFixture,
  world,
} from "./tests/fixture.ts";

const ctx = useRunTokenFixture();
const mint = (token: string, body: Record<string, unknown>) =>
  withToken(ctx.server, token).post("/api/v1/run-tokens", body);

/** A client that sends `Authorization: <header>` as given. */
const rawAuth = (url: string, header: string) => {
  const c = testClient(url, undefined);
  return {
    get: (path: string) =>
      c.request(path, { headers: { authorization: header } }),
  };
};

const rowsOf = (deviceId: string) =>
  ctx.db.select().from(runTokens).where(eq(runTokens.deviceId, deviceId));

describe("mint rate limit", () => {
  it("answers the 61st mint in a burst from one device with 429 rate_limited and Retry-After, and refills with time", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const other = await device(ctx.server, w.editor);
    const body = { project_id: w.projectA, verbs: ["read"] };
    for (let i = 0; i < 60; i += 1) {
      expect((await mint(d.deviceToken, body)).status).toBe(201);
    }
    const over = await mint(d.deviceToken, body);
    expectError(over, 429, "rate_limited");
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await rowsOf(d.deviceId)).toHaveLength(60);
    // Another device of the same person has its own bucket.
    expect((await mint(other.deviceToken, body)).status).toBe(201);
    ctx.advance(1);
    expect((await mint(d.deviceToken, body)).status).toBe(201);
  });
});

describe("purging expired run tokens", () => {
  it("deletes the minting device's expired run tokens, and keeps its live ones and other devices'", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const other = await device(ctx.server, w.editor);
    const body = { project_id: w.projectA, verbs: ["read"] };
    const short = await mintRunToken(ctx.server, d.deviceToken, {
      ...body,
      ttl_seconds: 60,
    });
    const long = await mintRunToken(ctx.server, d.deviceToken, body);
    const othersShort = await mintRunToken(ctx.server, other.deviceToken, {
      ...body,
      ttl_seconds: 60,
    });
    ctx.advance(60);
    const fresh = await mintRunToken(ctx.server, d.deviceToken, body);
    const hashes = (await rowsOf(d.deviceId)).map((r) => r.tokenHash).sort();
    expect(hashes).toEqual(
      [hashSecretToken(long.runToken), hashSecretToken(fresh.runToken)].sort(),
    );
    expect(hashes).not.toContain(hashSecretToken(short.runToken));
    const others = await rowsOf(other.deviceId);
    expect(others.map((r) => r.tokenHash)).toEqual([
      hashSecretToken(othersShort.runToken),
    ]);
  });
});

describe("the bearer scheme", () => {
  it("matches the scheme in any case and with extra spaces, so sbr_/sbd_ tokens never fall through", async () => {
    for (const header of [
      "bearer sbr_" + "x".repeat(43),
      "BEARER  sbd_" + "x".repeat(43),
      "Bearer\tsbr_" + "y".repeat(43),
    ]) {
      expectError(
        await rawAuth(ctx.server.url, header).get("/api/v1/tasks/ready"),
        401,
        "invalid_token",
      );
    }
  });

  it("resolves a valid run token sent with a lower-case scheme", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const run = await mintRunToken(ctx.server, d.deviceToken, {
      project_id: w.projectA,
      verbs: ["read"],
    });
    const res = await rawAuth(ctx.server.url, `bearer ${run.runToken}`).get(
      "/api/v1/devices",
    );
    // Resolved as the run token (a device route is not in the verb table), not 401.
    expectError(res, 403, "verb_not_allowed");
  });
});
