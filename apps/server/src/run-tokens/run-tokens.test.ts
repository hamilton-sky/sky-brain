// Run tokens (cloud-task-board ticket 02): mint and the resolver. Verbs and project binding are
// in verbs.test.ts.
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, devices, runTokens } from "../db/schema.ts";
import { mintRunToken, withToken } from "../testing/task-seeds.ts";
import { hashSecretToken } from "./secret-token.ts";
import {
  UUID,
  device,
  expectError,
  human,
  useRunTokenFixture,
  world,
} from "./test-fixture.ts";

const ctx = useRunTokenFixture();
const mint = (token: string, body: Record<string, unknown>) =>
  withToken(ctx.server, token).post("/api/v1/run-tokens", body);

describe("POST /api/v1/run-tokens", () => {
  it("mints for an owner: role editor, 1,800 s, hash stored, last_seen_at set, audit without the token", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.owner);
    const res = await mint(d.deviceToken, {
      project_id: w.projectA,
      verbs: ["read", "claim"],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      expires_at: new Date(ctx.now().getTime() + 1800_000).toISOString(),
      workspace_id: w.workspaceId,
      project_id: w.projectA,
      role: "editor",
      verbs: ["read", "claim"],
      device_id: d.deviceId,
    });
    const token: string = res.body.run_token;
    expect(token).toMatch(/^sbr_[A-Za-z0-9_-]{43}$/);
    const [row] = await ctx.db
      .select()
      .from(runTokens)
      .where(eq(runTokens.tokenHash, hashSecretToken(token)));
    expect(row).toMatchObject({
      deviceId: d.deviceId,
      workspaceId: w.workspaceId,
      projectId: w.projectA,
      role: "editor",
      verbs: ["read", "claim"],
    });
    expect(JSON.stringify(row)).not.toContain(token);
    const [dev] = await ctx.db
      .select()
      .from(devices)
      .where(eq(devices.id, d.deviceId));
    expect(dev?.lastSeenAt?.toISOString()).toBe(ctx.now().toISOString());
    const audit = await ctx.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "run_token.mint"),
          eq(auditLog.workspaceId, w.workspaceId),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: `agent:device/${d.deviceId}`,
      targetId: row!.id,
    });
    expect(audit[0]!.details).toMatchObject({
      device_id: d.deviceId,
      verbs: ["read", "claim"],
      role: "editor",
      ttl_seconds: 1800,
    });
    expect(JSON.stringify(audit[0])).not.toContain(token);
  });

  it("mints for an editor with a shorter ttl", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const minted = await mintRunToken(ctx.server, d.deviceToken, {
      project_id: w.projectA,
      verbs: ["plan"],
      ttl_seconds: 60,
    });
    expect(minted.runToken).toMatch(/^sbr_/);
    expect(minted.expiresAt).toBe(
      new Date(ctx.now().getTime() + 60_000).toISOString(),
    );
  });

  it("mints viewer for a viewer by default, and refuses editor with 403 role_too_high", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.viewer);
    const body = { project_id: w.projectA, verbs: ["read"] };
    const def = await mint(d.deviceToken, body);
    expect([def.status, def.body.role]).toEqual([201, "viewer"]);
    expectError(
      await mint(d.deviceToken, { ...body, role: "editor" }),
      403,
      "role_too_high",
    );
    const asked = await mint(d.deviceToken, { ...body, role: "viewer" });
    expect([asked.status, asked.body.role]).toEqual([201, "viewer"]);
  });

  it("lets an editor ask for viewer", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const res = await mint(d.deviceToken, {
      project_id: w.projectA,
      verbs: ["read"],
      role: "viewer",
    });
    expect([res.status, res.body.role]).toEqual([201, "viewer"]);
  });

  it("is 404 for a project without a members row for the device's person, or no such project", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.outsider);
    for (const project_id of [w.projectA, UUID]) {
      expectError(
        await mint(d.deviceToken, { project_id, verbs: ["read"] }),
        404,
        "not_found",
      );
    }
    const rows = await ctx.db
      .select()
      .from(runTokens)
      .where(eq(runTokens.deviceId, d.deviceId));
    expect(rows).toHaveLength(0);
  });

  it("refuses a body naming device_id or workspace_id, and bad verbs, role or ttl, with 400 invalid_request", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const base = { project_id: w.projectA, verbs: ["read"] };
    const bodies: Record<string, unknown>[] = [
      { ...base, device_id: d.deviceId },
      { ...base, workspace_id: w.workspaceId },
      { ...base, verbs: [] },
      { ...base, verbs: ["read", "read"] },
      { ...base, verbs: ["read", "plan", "claim", "report", "read"] },
      { ...base, verbs: ["post"] },
      { ...base, role: "owner" },
      { ...base, ttl_seconds: 59 },
      { ...base, ttl_seconds: 1801 },
      { ...base, ttl_seconds: 600.5 },
      { ...base, project_id: "not-a-uuid" },
      {},
    ];
    for (const body of bodies) {
      expectError(await mint(d.deviceToken, body), 400, "invalid_request");
    }
    const rows = await ctx.db
      .select()
      .from(runTokens)
      .where(eq(runTokens.deviceId, d.deviceId));
    expect(rows).toHaveLength(0);
  });

  it("accepts the edges: all four verbs, ttl 60 and ttl 1800", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    for (const ttl_seconds of [60, 1800]) {
      const res = await mint(d.deviceToken, {
        project_id: w.projectA,
        verbs: ["read", "plan", "claim", "report"],
        ttl_seconds,
      });
      expect(res.status).toBe(201);
    }
  });

  it("refuses a run token and a person with 403 verb_not_allowed", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const run = await mintRunToken(ctx.server, d.deviceToken, {
      project_id: w.projectA,
      verbs: ["read", "plan", "claim", "report"],
    });
    const body = { project_id: w.projectA, verbs: ["read"] };
    expectError(await mint(run.runToken, body), 403, "verb_not_allowed");
    expectError(
      await ctx.server.as(human(w.editor)).post("/api/v1/run-tokens", body),
      403,
      "verb_not_allowed",
    );
  });
});

describe("the resolver", () => {
  it("resolves a run token to the agent device/<id> on behalf of the device's person, with its run context", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const run = await mintRunToken(ctx.server, d.deviceToken, {
      project_id: w.projectA,
      verbs: ["read"],
    });
    const res = await ctx
      .onProbe(run.runToken)
      .get(`/api/v1/goals/${w.projectA}`);
    expect(res.status).toBe(200);
    expect(res.body.actor).toEqual({
      kind: "agent",
      agent_id: `device/${d.deviceId}`,
      on_behalf_of: w.editor,
    });
    expect(res.body.run).toMatchObject({
      kind: "run",
      deviceId: d.deviceId,
      workspaceId: w.workspaceId,
      projectId: w.projectA,
      role: "editor",
      verbs: ["read"],
    });
  });

  it("refuses an expired run token with 401 invalid_token, from exactly expires_at", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const run = await mintRunToken(ctx.server, d.deviceToken, {
      project_id: w.projectA,
      verbs: ["read", "claim"],
      ttl_seconds: 60,
    });
    const probe = ctx.onProbe(run.runToken);
    ctx.advance(59);
    expect((await probe.get(`/api/v1/goals/${w.projectA}`)).status).toBe(200);
    ctx.advance(1);
    expectError(
      await probe.get(`/api/v1/goals/${w.projectA}`),
      401,
      "invalid_token",
    );
    const c = withToken(ctx.server, run.runToken);
    expectError(await c.get("/api/v1/devices"), 401, "invalid_token");
    expectError(
      await c.post(`/api/v1/tasks/${UUID}/claim`, {}),
      401,
      "invalid_token",
    );
  });

  it("refuses a revoked device's run token and device token with 401 invalid_token", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const run = await mintRunToken(ctx.server, d.deviceToken, {
      project_id: w.projectA,
      verbs: ["read"],
    });
    const revoked = await ctx.server
      .as(human(w.editor))
      .post(`/api/v1/devices/${d.deviceId}/revoke`);
    expect(revoked.status).toBe(200);
    expectError(
      await ctx.onProbe(run.runToken).get(`/api/v1/goals/${w.projectA}`),
      401,
      "invalid_token",
    );
    expectError(
      await withToken(ctx.server, run.runToken).get("/api/v1/devices"),
      401,
      "invalid_token",
    );
    expectError(
      await mint(d.deviceToken, { project_id: w.projectA, verbs: ["read"] }),
      401,
      "invalid_token",
    );
  });

  it("refuses unknown sbr_ and sbd_ tokens with 401 invalid_token", async () => {
    for (const token of [
      "sbr_" + "x".repeat(43),
      "sbd_" + "x".repeat(43),
      "sbr_",
    ]) {
      expectError(
        await withToken(ctx.server, token).get("/api/v1/tasks/ready"),
        401,
        "invalid_token",
      );
    }
  });

  it("leaves other bearer tokens to the next resolver: the harness's own still resolve", async () => {
    const res = await ctx.server.as(human("rt-plain")).get("/api/v1/devices");
    expect(res.status).toBe(200);
    expectError(
      await withToken(ctx.server, "not-a-known-token").get("/api/v1/devices"),
      401,
      "unauthenticated",
    );
  });
});
