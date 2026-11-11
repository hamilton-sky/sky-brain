// Story: A person logs a machine in once.
import { describe, expect, it } from "vitest";
import {
  agent,
  deviceCode,
  expectError,
  expectFlowError,
  expectStatus,
  human,
  loginDevice,
  pollToken,
  setup,
  uid,
} from "./helpers.ts";

const ctx = setup();
const USER_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

describe("device code", () => {
  // "`POST /api/device/code` with no credential returns a `device_code`, an 8-character
  // `user_code` (`XXXX-XXXX`, from `BCDFGHJKLMNPQRSTVWXZ`), `verification_uri`, `expires_in: 900`
  // and `interval: 5`."
  it("POST /api/device/code with no credential returns device_code, user_code, verification_uri, expires_in 900, interval 5", async () => {
    const res = await ctx.server.anonymous.post("/api/device/code", {
      client_name: "pathly",
    });
    expectStatus(res, 200);
    expect(typeof res.body.device_code).toBe("string");
    expect(res.body.device_code.length).toBeGreaterThan(0);
    expect(res.body.user_code).toMatch(USER_CODE);
    expect(typeof res.body.verification_uri).toBe("string");
    expect(res.body.verification_uri.length).toBeGreaterThan(0);
    expect(res.body.expires_in).toBe(900);
    expect(res.body.interval).toBe(5);
    const again = await deviceCode(ctx);
    expect(again.device_code).not.toBe(res.body.device_code);
  });
});

describe("polling for the token", () => {
  // "Polling `POST /api/device/token` before approval returns 400
  // `{"error":"authorization_pending"}`; ..."
  it("polling before approval returns 400 authorization_pending", async () => {
    const code = await deviceCode(ctx);
    expectFlowError(await pollToken(ctx, code.device_code), "authorization_pending");
  });

  // "... polling again sooner than `interval` seconds after the last poll returns 400
  // `{"error":"slow_down"}`; ..."
  // Edge: "Poll faster than `interval` | 400 `slow_down`; the client adds 5 s"
  it("polling again sooner than interval seconds after the last poll returns 400 slow_down", async () => {
    const code = await deviceCode(ctx);
    expectFlowError(await pollToken(ctx, code.device_code), "authorization_pending");
    ctx.advance(2);
    expectFlowError(await pollToken(ctx, code.device_code), "slow_down");
  });

  // "... after 900 seconds it returns 400 `{"error":"expired_token"}`."
  it("polling after 900 seconds returns 400 expired_token", async () => {
    const code = await deviceCode(ctx);
    ctx.advance(901);
    expectFlowError(await pollToken(ctx, code.device_code), "expired_token");
  });
});

describe("approve", () => {
  // "A person calling `POST /api/v1/devices/approve` with the user code (any case, dash
  // optional) and a name creates a device that belongs to them; the next poll returns 200 with a
  // `device_token` exactly once, and any later poll with that code returns 400
  // `{"error":"invalid_grant"}`."
  // Edge: "Device code used after its token was issued | 400 `invalid_grant`"
  it("approve creates the person's device; the next poll returns the device_token once, later polls invalid_grant", async () => {
    const person = uid("person");
    const code = await deviceCode(ctx);
    const approved = await ctx.server
      .as(human(person))
      .post("/api/v1/devices/approve", {
        user_code: code.user_code,
        name: "laptop 1",
      });
    expectStatus(approved, 200);
    expect(approved.body.device.name).toBe("laptop 1");
    expect(approved.body.device.revoked_at).toBeNull();
    const list = await ctx.server.as(human(person)).get("/api/v1/devices");
    expectStatus(list, 200);
    expect(list.body.devices.map((d: { id: string }) => d.id)).toEqual([
      approved.body.device.id,
    ]);

    const first = await pollToken(ctx, code.device_code);
    expectStatus(first, 200);
    expect(typeof first.body.device_token).toBe("string");
    expect(first.body.device_token.length).toBeGreaterThan(0);
    expect(first.body.device_id).toBe(approved.body.device.id);

    ctx.advance(6);
    expectFlowError(await pollToken(ctx, code.device_code), "invalid_grant");
    ctx.advance(6);
    expectFlowError(await pollToken(ctx, code.device_code), "invalid_grant");
  });

  // Edge: "User code typed in lower case or without the dash | accepted"
  it.each([
    ["lower case", (c: string) => c.toLowerCase()],
    ["without the dash", (c: string) => c.replace("-", "")],
    ["lower case without the dash", (c: string) => c.replace("-", "").toLowerCase()],
  ])("accepts the user code typed in %s", async (_label, typed) => {
    const person = uid("person");
    const code = await deviceCode(ctx);
    const res = await ctx.server
      .as(human(person))
      .post("/api/v1/devices/approve", {
        user_code: typed(code.user_code),
        name: "laptop",
      });
    expectStatus(res, 200);
    const token = await pollToken(ctx, code.device_code);
    expectStatus(token, 200);
    expect(token.body.device_id).toBe(res.body.device.id);
  });

  // "An agent calling approve gets 403 `humans_only`; ..."
  it("an agent calling approve gets 403 humans_only and the code stays pending", async () => {
    const person = uid("person");
    const code = await deviceCode(ctx);
    expectError(
      await ctx.server
        .as(agent(person))
        .post("/api/v1/devices/approve", {
          user_code: code.user_code,
          name: "laptop",
        }),
      403,
      "humans_only",
    );
    expectFlowError(await pollToken(ctx, code.device_code), "authorization_pending");
    const list = await ctx.server.as(human(person)).get("/api/v1/devices");
    expectStatus(list, 200);
    expect(list.body.devices).toEqual([]);
  });

  // "... a wrong or expired user code gets 404 `not_found`; ..."
  it("a wrong user code gets 404 not_found", async () => {
    const person = uid("person");
    await deviceCode(ctx);
    expectError(
      await ctx.server
        .as(human(person))
        .post("/api/v1/devices/approve", { user_code: "BCDF-GHJK", name: "x" }),
      404,
      "not_found",
    );
  });

  it("an expired user code gets 404 not_found", async () => {
    const person = uid("person");
    const code = await deviceCode(ctx);
    ctx.advance(901);
    expectError(
      await ctx.server
        .as(human(person))
        .post("/api/v1/devices/approve", {
          user_code: code.user_code,
          name: "x",
        }),
      404,
      "not_found",
    );
  });

  // "... more than 5 approve calls from one person in 15 minutes get 429 `rate_limited`."
  it("more than 5 approve calls from one person in 15 minutes get 429 rate_limited", async () => {
    const person = uid("person");
    const me = ctx.server.as(human(person));
    for (let i = 0; i < 5; i += 1) {
      const res = await me.post("/api/v1/devices/approve", {
        user_code: "BCDF-GHJK",
        name: "x",
      });
      expectError(res, 404, "not_found");
    }
    const code = await deviceCode(ctx);
    const sixth = await me.post("/api/v1/devices/approve", {
      user_code: code.user_code,
      name: "x",
    });
    expectError(sixth, 429, "rate_limited");
    expect(sixth.headers.get("retry-after")).not.toBeNull();
    expectFlowError(await pollToken(ctx, code.device_code), "authorization_pending");
  });
});

describe("devices list and revoke", () => {
  // "`GET /api/v1/devices` lists only the caller's own devices; `POST
  // /api/v1/devices/:id/revoke` revokes one of them (another person's device is 404)."
  it("GET /api/v1/devices lists only the caller's own devices", async () => {
    const a = uid("person");
    const b = uid("person");
    const a1 = await loginDevice(ctx, a, "a laptop");
    const a2 = await loginDevice(ctx, a, "a desktop");
    const b1 = await loginDevice(ctx, b, "b laptop");
    const listA = await ctx.server.as(human(a)).get("/api/v1/devices");
    expectStatus(listA, 200);
    expect(
      listA.body.devices.map((d: { id: string }) => d.id).sort(),
    ).toEqual([a1.deviceId, a2.deviceId].sort());
    const listB = await ctx.server.as(human(b)).get("/api/v1/devices");
    expect(listB.body.devices.map((d: { id: string }) => d.id)).toEqual([
      b1.deviceId,
    ]);
  });

  it("POST /api/v1/devices/:id/revoke revokes the caller's own device", async () => {
    const a = uid("person");
    const d = await loginDevice(ctx, a);
    const res = await ctx.server
      .as(human(a))
      .post(`/api/v1/devices/${d.deviceId}/revoke`);
    expectStatus(res, 200);
    expect(res.body.device.id).toBe(d.deviceId);
    expect(res.body.device.revoked_at).not.toBeNull();
    const list = await ctx.server.as(human(a)).get("/api/v1/devices");
    const row = list.body.devices.find((x: { id: string }) => x.id === d.deviceId);
    expect(row.revoked_at).not.toBeNull();
  });

  it("revoking another person's device is 404 and leaves it unrevoked", async () => {
    const a = uid("person");
    const b = uid("person");
    const bd = await loginDevice(ctx, b);
    expectError(
      await ctx.server
        .as(human(a))
        .post(`/api/v1/devices/${bd.deviceId}/revoke`),
      404,
      "not_found",
    );
    const list = await ctx.server.as(human(b)).get("/api/v1/devices");
    const row = list.body.devices.find((x: { id: string }) => x.id === bd.deviceId);
    expect(row.revoked_at).toBeNull();
  });
});
