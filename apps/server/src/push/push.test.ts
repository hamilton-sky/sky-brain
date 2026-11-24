// Web push (D33): a person subscribes their own browser; an agent's approval request alerts
// every subscription of that person with a generic text (no item titles); a gone subscription is
// removed; agents cannot subscribe; nobody can remove another person's subscription.
import type { Actor } from "@sky-brain/shared/actor";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pushSubscriptions } from "../db/schema.ts";
import {
  closeTestDb,
  createTestDb,
  seedProject,
  seedWorkspace,
  startTestServer,
  type Db,
  type TestServer,
} from "../testing/harness.ts";
import { seedGoal } from "../testing/task-seeds.ts";
import { createPush, type PushTarget } from "./push.ts";

let db: Db;
let server: TestServer;
let pushOff: TestServer;
let projectId: string;
let wsId: string;
const sent: { target: PushTarget; payload: Record<string, unknown> }[] = [];
const statusFor = new Map<string, number>();

const ann: Actor = { kind: "human", user_id: "ann" };
const annAgent: Actor = {
  kind: "agent",
  agent_id: "mcp/claude.ai/po",
  on_behalf_of: "ann",
};
const ben: Actor = { kind: "human", user_id: "ben" };

const sub = (n: number) => ({
  endpoint: `https://push.example.test/send/${n}`,
  keys: { p256dh: `key-${n}`, auth: `auth-${n}` },
  expirationTime: null,
});

beforeAll(async () => {
  db = await createTestDb();
  wsId = (
    await seedWorkspace(db, {
      name: "ann",
      members: [{ userId: "ann", role: "owner" }],
    })
  ).id;
  await seedWorkspace(db, {
    name: "ben",
    members: [{ userId: "ben", role: "owner" }],
  });
  projectId = (
    await seedProject(db, { workspaceId: wsId, slug: "home", name: "Home" })
  ).id;
  const push = createPush("public-key", (target, payload) => {
    sent.push({ target, payload: JSON.parse(payload) });
    return Promise.resolve(statusFor.get(target.endpoint) ?? 201);
  });
  server = await startTestServer({ db, push });
  pushOff = await startTestServer({ db });
}, 60_000);

afterAll(async () => {
  await server?.close();
  await pushOff?.close();
  if (db) await closeTestDb(db);
});

const endpointsOf = async (userId: string) =>
  (
    await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
  ).map((s) => s.endpoint);

describe("subscribing", () => {
  it("gives the public key, and is off without one", async () => {
    expect((await server.as(ann).get("/api/v1/push/key")).body).toEqual({
      public_key: "public-key",
    });
    expect((await pushOff.as(ann).get("/api/v1/push/key")).body).toEqual({
      public_key: null,
    });
    const off = await pushOff.as(ann).post("/api/v1/push/subscribe", sub(0));
    expect(off.status).toBe(503);
  });

  it("a person subscribes their browsers; an agent cannot", async () => {
    const add = (n: number) =>
      server.as(ann).post("/api/v1/push/subscribe", sub(n));
    expect((await add(1)).status).toBe(201);
    expect((await add(2)).status).toBe(201);
    expect((await add(1)).status).toBe(201);
    expect(await endpointsOf("ann")).toHaveLength(2);
    const agent = await server
      .as(annAgent)
      .post("/api/v1/push/subscribe", sub(3));
    expect(agent.status).toBe(403);
    const insecure = await server.as(ann).post("/api/v1/push/subscribe", {
      ...sub(4),
      endpoint: "http://push.example.test/x",
    });
    expect(insecure.status).toBe(400);
  });

  it("nobody removes another person's subscription", async () => {
    await server
      .as(ben)
      .post("/api/v1/push/unsubscribe", { endpoint: sub(2).endpoint });
    expect(await endpointsOf("ann")).toContain(sub(2).endpoint);
  });
});

describe("alerting", () => {
  it("an agent's request alerts every browser of its person, with no item text", async () => {
    sent.length = 0;
    statusFor.set(sub(2).endpoint, 410);
    const goal = await seedGoal(db, {
      workspaceId: wsId,
      projectId,
      title: "Secret family plan",
    });
    const res = await server.as(annAgent).post("/api/v1/approvals", {
      items: [{ kind: "goal", id: goal.id }],
      reason: "Ready",
    });
    expect(res.status).toBe(201);
    expect(sent.map((s) => s.target.endpoint).sort()).toEqual(
      [sub(1).endpoint, sub(2).endpoint].sort(),
    );
    const payload = sent[0]!.payload;
    expect(payload.path).toBe(`/a/${res.body.approval.id}`);
    expect(JSON.stringify(payload)).not.toContain("Secret");
    expect(JSON.stringify(payload)).not.toContain("Ready");
    // 410: that browser is gone, so its row is removed.
    expect(await endpointsOf("ann")).toEqual([sub(1).endpoint]);
  });

  it("a person's own request sends nothing", async () => {
    sent.length = 0;
    const goal = await seedGoal(db, { workspaceId: wsId, projectId });
    await server.as(ann).post("/api/v1/approvals", {
      items: [{ kind: "goal", id: goal.id }],
      reason: "Mine",
    });
    expect(sent).toHaveLength(0);
  });

  it("a person unsubscribes their own browser", async () => {
    await server
      .as(ann)
      .post("/api/v1/push/unsubscribe", { endpoint: sub(1).endpoint });
    expect(await endpointsOf("ann")).toEqual([]);
  });
});
