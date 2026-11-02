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
const USER_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

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
const person = () => `flow-person-${++n}`;

async function code(): Promise<{ device_code: string; user_code: string }> {
  const res = await server.anonymous.post("/api/device/code", {
    client_name: "pathly",
  });
  expect(res.status).toBe(200);
  return res.body;
}

const poll = (deviceCode: string, extra: Record<string, unknown> = {}) =>
  server.anonymous.post("/api/device/token", {
    grant_type: GRANT,
    device_code: deviceCode,
    ...extra,
  });

function flowError(res: TestResponse, error: string, status = 400): void {
  expect({ status: res.status, body: res.body }).toEqual({
    status,
    body: { error },
  });
}

describe("POST /api/device/code", () => {
  it("answers a device code, a user code, the uri, expires_in 900 and interval 5", async () => {
    const res = await server.anonymous.post("/api/device/code", {
      client_name: "pathly",
    });
    expect(res.status).toBe(200);
    expect(res.body.user_code).toMatch(USER_CODE);
    expect(res.body.device_code.length).toBeGreaterThanOrEqual(43);
    expect(typeof res.body.verification_uri).toBe("string");
    expect(res.body.expires_in).toBe(900);
    expect(res.body.interval).toBe(5);
    const other = await code();
    expect(other.device_code).not.toBe(res.body.device_code);
  });

  it("stores only the hash of the device code", async () => {
    const c = await code();
    const rows = await db
      .select()
      .from(deviceCodes)
      .where(eq(deviceCodes.deviceCodeHash, hashSecretToken(c.device_code)));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(c.device_code);
  });

  it.each([
    ["no body", undefined],
    ["an empty client_name", { client_name: "" }],
    ["a client_name over 64 characters", { client_name: "x".repeat(65) }],
    ["an unknown field", { client_name: "pathly", user_id: "mallory" }],
  ])("refuses %s with 400 invalid_request", async (_label, body) => {
    flowError(
      await server.anonymous.post("/api/device/code", body),
      "invalid_request",
    );
  });

  it("answers broken JSON in the RFC 8628 shape", async () => {
    const res = await server.anonymous.request("/api/device/code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{nope",
    });
    flowError(res, "invalid_request");
  });
});

describe("POST /api/device/token", () => {
  it("answers authorization_pending before approval", async () => {
    const c = await code();
    flowError(await poll(c.device_code), "authorization_pending");
  });

  it("answers slow_down to a poll sooner than the interval, and pending again after it", async () => {
    const c = await code();
    flowError(await poll(c.device_code), "authorization_pending");
    advance(4);
    flowError(await poll(c.device_code), "slow_down");
    advance(5);
    flowError(await poll(c.device_code), "authorization_pending");
  });

  it("answers expired_token after 900 seconds by the app clock", async () => {
    const c = await code();
    advance(899);
    flowError(await poll(c.device_code), "authorization_pending");
    advance(1);
    flowError(await poll(c.device_code), "expired_token");
  });

  it("answers invalid_grant for an unknown device code", async () => {
    flowError(await poll("not-a-device-code"), "invalid_grant");
  });

  it("returns the device token once, stores only its hash, then invalid_grant", async () => {
    const c = await code();
    const approved = await server
      .as({ kind: "human", user_id: person() })
      .post("/api/v1/devices/approve", { user_code: c.user_code, name: "box" });
    expect(approved.status).toBe(200);

    const first = await poll(c.device_code);
    expect(first.status).toBe(200);
    expect(first.body.device_token).toMatch(/^sbd_/);
    expect(first.body.device_id).toBe(approved.body.device.id);
    const [row] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, first.body.device_id));
    expect(row?.secretHash).toBe(hashSecretToken(first.body.device_token));

    advance(6);
    flowError(await poll(c.device_code), "invalid_grant");
    advance(6);
    flowError(await poll(c.device_code), "invalid_grant");
  });

  it("refuses a wrong grant_type with unsupported_grant_type", async () => {
    const c = await code();
    flowError(
      await poll(c.device_code, { grant_type: "password" }),
      "unsupported_grant_type",
    );
  });

  it("refuses an unknown field with invalid_request", async () => {
    const c = await code();
    flowError(await poll(c.device_code, { device_id: "x" }), "invalid_request");
  });
});
