// The device flow's guards against a hostile anonymous caller and its edge cases at expiry and
// revoke (ticket 01 review round 1).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashSecretToken } from "../run-tokens/secret-token.ts";
import { deviceCodes, devices } from "../db/schema.ts";
import {
  closeTestDb,
  createTestDb,
  startTestServer,
  type Db,
  type TestResponse,
  type TestServer,
} from "../testing/harness.ts";

const GRANT = "urn:ietf:params:oauth:grant-type:device_code";

let db: Db;
let server: TestServer;
let t = new Date("2026-11-02T10:00:00Z");
const advance = (seconds: number) => {
  t = new Date(t.getTime() + seconds * 1000);
};

beforeAll(async () => {
  db = await createTestDb();
  server = await startTestServer({ db, now: () => t });
}, 60_000);

afterAll(async () => {
  if (server) await server.close();
  if (db) await closeTestDb(db);
}, 60_000);

let n = 0;
const person = () => ({ kind: "human" as const, user_id: `guard-${++n}` });

/** A POST as if a proxy in front of the app had sent it on for `from`. */
const postFrom = (
  from: string,
  path: string,
  body: unknown,
  extra: Record<string, string> = {},
) =>
  server.anonymous.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": from,
      ...extra,
    },
    body: JSON.stringify(body),
  });

async function code(): Promise<{ device_code: string; user_code: string }> {
  const res = await server.anonymous.post("/api/device/code", {
    client_name: "pathly",
  });
  expect(res.status).toBe(200);
  return res.body;
}

const poll = (deviceCode: string) =>
  server.anonymous.post("/api/device/token", {
    grant_type: GRANT,
    device_code: deviceCode,
  });

function flowError(res: TestResponse, error: string, status = 400): void {
  expect({ status: res.status, body: res.body }).toEqual({
    status,
    body: { error },
  });
}

const approve = (who: ReturnType<typeof person>, userCode: string) =>
  server
    .as(who)
    .post("/api/v1/devices/approve", { user_code: userCode, name: "box" });

async function rowOf(deviceCode: string) {
  const [row] = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.deviceCodeHash, hashSecretToken(deviceCode)));
  return row;
}

describe("rate limits per client address", () => {
  it("answers the 61st device code request from one address at once with 429, another address goes on", async () => {
    for (let i = 0; i < 60; i += 1) {
      const res = await postFrom("198.51.100.1", "/api/device/code", {
        client_name: "pathly",
      });
      expect(res.status).toBe(200);
    }
    const over = await postFrom("198.51.100.1", "/api/device/code", {
      client_name: "pathly",
    });
    flowError(over, "rate_limited", 429);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
    const other = await postFrom("198.51.100.2", "/api/device/code", {
      client_name: "pathly",
    });
    expect(other.status).toBe(200);
  });

  it("answers the 61st poll from one address at once with 429", async () => {
    const body = { grant_type: GRANT, device_code: "not-a-device-code" };
    for (let i = 0; i < 60; i += 1) {
      flowError(
        await postFrom("198.51.100.3", "/api/device/token", body),
        "invalid_grant",
      );
    }
    const over = await postFrom("198.51.100.3", "/api/device/token", body);
    flowError(over, "rate_limited", 429);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("expired codes", () => {
  it("deletes never-approved codes 900 s after they expired, and keeps approved ones", async () => {
    const stale = await code();
    const kept = await code();
    expect((await approve(person(), kept.user_code)).status).toBe(200);
    advance(900 + 899);
    await code();
    expect(await rowOf(stale.device_code)).toBeDefined();
    advance(1);
    await code();
    expect(await rowOf(stale.device_code)).toBeUndefined();
    expect(await rowOf(kept.device_code)).toBeDefined();
    flowError(await poll(stale.device_code), "invalid_grant");
  });

  it("issues the token to a code approved at second 899 and polled at second 901", async () => {
    const c = await code();
    advance(899);
    expect((await approve(person(), c.user_code)).status).toBe(200);
    advance(2);
    const res = await poll(c.device_code);
    expect(res.status).toBe(200);
    expect(res.body.device_token).toMatch(/^sbd_/);
  });

  it("answers expired_token to an approved code first polled 60 s after it expired", async () => {
    const c = await code();
    expect((await approve(person(), c.user_code)).status).toBe(200);
    advance(900 + 60);
    flowError(await poll(c.device_code), "expired_token");
  });
});

describe("a device revoked before its first poll", () => {
  it("gets invalid_grant and no token hash is stored", async () => {
    const who = person();
    const c = await code();
    const approved = await approve(who, c.user_code);
    expect(approved.status).toBe(200);
    const id = approved.body.device.id;
    expect(
      (await server.as(who).post(`/api/v1/devices/${id}/revoke`)).status,
    ).toBe(200);
    flowError(await poll(c.device_code), "invalid_grant");
    const [row] = await db.select().from(devices).where(eq(devices.id, id));
    expect(row?.secretHash).toBeNull();
  });
});

describe("verification_uri", () => {
  it("uses the scheme the proxy in front of the app says", async () => {
    const res = await postFrom(
      "198.51.100.4",
      "/api/device/code",
      { client_name: "pathly" },
      { "x-forwarded-proto": "https" },
    );
    expect(res.status).toBe(200);
    expect(res.body.verification_uri).toMatch(
      /^https:\/\/[^/]+\/devices\/approve$/,
    );
  });
});
