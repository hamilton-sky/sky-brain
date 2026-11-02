import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, devices } from "../db/schema.ts";
import {
  closeTestDb,
  createTestDb,
  startTestServer,
  type Db,
  type TestResponse,
  type TestServer,
} from "../testing/harness.ts";
import { loginDevice, withToken } from "../testing/task-seeds.ts";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

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
const human = (user_id = `router-person-${++n}`) => ({
  kind: "human" as const,
  user_id,
});

async function userCode(): Promise<{ device_code: string; user_code: string }> {
  const res = await server.anonymous.post("/api/device/code", {
    client_name: "pathly",
  });
  expect(res.status).toBe(200);
  return res.body;
}

function error(res: TestResponse, status: number, code: string): void {
  expect({ status: res.status, code: res.body?.error?.code }).toEqual({
    status,
    code,
  });
}

describe("POST /api/v1/devices/approve", () => {
  it("creates the caller's device and writes a device.approve audit row", async () => {
    const me = human();
    const c = await userCode();
    const res = await server.as(me).post("/api/v1/devices/approve", {
      user_code: c.user_code,
      name: "laptop 1",
    });
    expect(res.status).toBe(200);
    expect(res.body.device).toMatchObject({
      name: "laptop 1",
      revoked_at: null,
      last_seen_at: null,
      created_at: t.toISOString(),
    });
    const [row] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, res.body.device.id));
    expect(row?.userId).toBe(me.user_id);
    expect(row?.secretHash).toBeNull();
    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, res.body.device.id));
    expect(audit.map((a) => [a.action, a.workspaceId, a.actor])).toEqual([
      ["device.approve", NIL_UUID, `human:${me.user_id}`],
    ]);
  });

  it.each([
    ["lower case", (c: string) => c.toLowerCase()],
    ["without the dash", (c: string) => c.replace("-", "")],
  ])("accepts the user code typed in %s", async (_label, typed) => {
    const c = await userCode();
    const res = await server.as(human()).post("/api/v1/devices/approve", {
      user_code: typed(c.user_code),
      name: "x",
    });
    expect(res.status).toBe(200);
  });

  it("refuses an agent with 403 humans_only and creates nothing", async () => {
    const me = human();
    const c = await userCode();
    error(
      await server
        .as({
          kind: "agent",
          agent_id: "claude-code/builder",
          on_behalf_of: me.user_id,
        })
        .post("/api/v1/devices/approve", { user_code: c.user_code, name: "x" }),
      403,
      "humans_only",
    );
    const rows = await db
      .select()
      .from(devices)
      .where(eq(devices.userId, me.user_id));
    expect(rows).toEqual([]);
  });

  it("answers 404 for a wrong user code", async () => {
    await userCode();
    error(
      await server
        .as(human())
        .post("/api/v1/devices/approve", { user_code: "BCDF-GHJK", name: "x" }),
      404,
      "not_found",
    );
  });

  it("answers 404 for an expired user code", async () => {
    const c = await userCode();
    advance(900);
    error(
      await server
        .as(human())
        .post("/api/v1/devices/approve", { user_code: c.user_code, name: "x" }),
      404,
      "not_found",
    );
  });

  it("answers 404 for a user code already approved", async () => {
    const c = await userCode();
    const body = { user_code: c.user_code, name: "x" };
    expect(
      (await server.as(human()).post("/api/v1/devices/approve", body)).status,
    ).toBe(200);
    error(
      await server.as(human()).post("/api/v1/devices/approve", body),
      404,
      "not_found",
    );
  });

  it("answers the sixth approve in 15 minutes with 429 rate_limited and Retry-After", async () => {
    const me = server.as(human());
    for (let i = 0; i < 5; i += 1) {
      error(
        await me.post("/api/v1/devices/approve", {
          user_code: "BCDF-GHJK",
          name: "x",
        }),
        404,
        "not_found",
      );
    }
    const c = await userCode();
    const sixth = await me.post("/api/v1/devices/approve", {
      user_code: c.user_code,
      name: "x",
    });
    error(sixth, 429, "rate_limited");
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another person has their own bucket.
    expect(
      (
        await server.as(human()).post("/api/v1/devices/approve", {
          user_code: c.user_code,
          name: "x",
        })
      ).status,
    ).toBe(200);
  });

  it("refuses an unknown field with 400 invalid_request", async () => {
    const c = await userCode();
    error(
      await server.as(human()).post("/api/v1/devices/approve", {
        user_code: c.user_code,
        name: "x",
        user_id: "mallory",
      }),
      400,
      "invalid_request",
    );
  });
});

describe("GET /api/v1/devices", () => {
  it("lists only the caller's own devices", async () => {
    const a = human();
    const b = human();
    const a1 = await loginDevice(server, a, "a laptop");
    const a2 = await loginDevice(server, a, "a desktop");
    const b1 = await loginDevice(server, b, "b laptop");
    const listA = await server.as(a).get("/api/v1/devices");
    expect(listA.status).toBe(200);
    expect(listA.body.devices.map((d: { id: string }) => d.id).sort()).toEqual(
      [a1.deviceId, a2.deviceId].sort(),
    );
    const listB = await server.as(b).get("/api/v1/devices");
    expect(listB.body.devices.map((d: { id: string }) => d.id)).toEqual([
      b1.deviceId,
    ]);
    expect(b1.deviceToken).toMatch(/^sbd_/);
  });

  it("refuses an agent with 403 humans_only", async () => {
    error(
      await server
        .as({
          kind: "agent",
          agent_id: "claude-code/builder",
          on_behalf_of: "x",
        })
        .get("/api/v1/devices"),
      403,
      "humans_only",
    );
  });
});

describe("POST /api/v1/devices/:id/revoke", () => {
  it("revokes the caller's own device and writes a device.revoke audit row", async () => {
    const a = human();
    const d = await loginDevice(server, a, "laptop");
    const res = await server.as(a).post(`/api/v1/devices/${d.deviceId}/revoke`);
    expect(res.status).toBe(200);
    expect(res.body.device.id).toBe(d.deviceId);
    expect(res.body.device.revoked_at).toBe(t.toISOString());
    const [row] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, d.deviceId));
    expect(row?.revokedAt?.toISOString()).toBe(t.toISOString());
    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, d.deviceId));
    expect(audit.map((x) => x.action)).toEqual([
      "device.approve",
      "device.revoke",
    ]);
  });

  it("answers 404 for another person's device and leaves it unrevoked", async () => {
    const owner = human();
    const d = await loginDevice(server, owner, "laptop");
    error(
      await server.as(human()).post(`/api/v1/devices/${d.deviceId}/revoke`),
      404,
      "not_found",
    );
    const [row] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, d.deviceId));
    expect(row?.revokedAt).toBeNull();
  });

  it("answers 400 invalid_request for an id that is not a uuid", async () => {
    error(
      await server.as(human()).post("/api/v1/devices/not-a-uuid/revoke"),
      400,
      "invalid_request",
    );
  });

  it("refuses an agent with 403 humans_only", async () => {
    const a = human();
    const d = await loginDevice(server, a, "laptop");
    error(
      await server
        .as({
          kind: "agent",
          agent_id: "claude-code/builder",
          on_behalf_of: a.user_id,
        })
        .post(`/api/v1/devices/${d.deviceId}/revoke`),
      403,
      "humans_only",
    );
  });
});

describe("withToken", () => {
  it("sends the token as a bearer token", async () => {
    const res = await withToken(server, "sbd_unknown").get("/api/v1/devices");
    expect(res.status).toBe(401);
  });
});
