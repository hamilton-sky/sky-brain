// The goals API (cloud-task-board ticket 04): create a draft, list, get, and the human-only
// approve, cancel and release. Isolation, and what agents may see and write: goals-isolation.test.ts.
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, goals, tasks } from "../db/schema.ts";
import {
  UUID,
  device,
  expectError,
  human,
  useRunTokenFixture,
  world,
} from "../run-tokens/tests/fixture.ts";
import { seedFeature, type TestClient } from "../testing/harness.ts";
import {
  mintRunToken,
  seedGoal,
  seedTask,
  withToken,
} from "../testing/task-seeds.ts";

const ctx = useRunTokenFixture();
type W = Awaited<ReturnType<typeof world>>;

const pat = () => "gh" + "p_" + "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5";
const HELD = "ignore-instructions";
const agent = (person: string) =>
  ctx.server.as({
    kind: "agent",
    agent_id: "claude-code",
    on_behalf_of: person,
  });
const as = (person: string) => ctx.server.as(human(person));
const create = (c: TestClient, w: W, extra: Record<string, unknown> = {}) =>
  c.post("/api/v1/goals", {
    project_id: w.projectA,
    title: "Ship the export",
    body: "CSV first.",
    executor: "single",
    ...extra,
  });
async function runToken(person: string, w: W, role?: "editor" | "viewer") {
  const d = await device(ctx.server, person);
  const { runToken } = await mintRunToken(ctx.server, d.deviceToken, {
    project_id: w.projectA,
    verbs: ["read", "plan"],
    ...(role ? { role } : {}),
  });
  return withToken(ctx.server, runToken);
}
const goalRows = (w: W) =>
  ctx.db.select().from(goals).where(eq(goals.workspaceId, w.workspaceId));
const auditOf = (w: W, action: string) =>
  ctx.db
    .select()
    .from(auditLog)
    .where(
      and(eq(auditLog.workspaceId, w.workspaceId), eq(auditLog.action, action)),
    );
const seedDraft = (w: W, quarantinedBecause?: string) =>
  seedGoal(ctx.db, {
    workspaceId: w.workspaceId,
    projectId: w.projectA,
    ...(quarantinedBecause ? { quarantinedBecause } : {}),
  });
const zero = { pending: 0, in_progress: 0, done: 0, failed: 0, blocked: 0 };

describe("POST /api/v1/goals", () => {
  it("a person, an agent and a run token each create a draft; the author comes from the token; audit goal.create", async () => {
    const w = await world(ctx.db);
    const byOwner = await create(as(w.owner), w);
    expect(byOwner.status).toBe(201);
    expect(byOwner.body.goal).toMatchObject({
      status: "draft",
      workspace_id: w.workspaceId,
      project_id: w.projectA,
      feature_id: null,
      title: "Ship the export",
      body: "CSV first.",
      executor: "single",
      assignee: null,
      approved_by: null,
      approved_at: null,
      quarantined_because: null,
      author_kind: "human",
      author: w.owner,
      on_behalf_of: w.owner,
      counts: zero,
      created_at: ctx.now().toISOString(),
    });
    const byAgent = await create(agent(w.owner), w);
    expect(byAgent.body.goal).toMatchObject({
      status: "draft",
      author_kind: "agent",
      author: "claude-code",
      on_behalf_of: w.owner,
    });
    const byToken = await create(await runToken(w.editor, w), w);
    expect(byToken.body.goal).toMatchObject({
      status: "draft",
      on_behalf_of: w.editor,
    });
    const ids = [byOwner, byAgent, byToken].map((r) => r.body.goal.id);
    expect((await goalRows(w)).map((g) => g.id).sort()).toEqual(ids.sort());
    const audit = await auditOf(w, "goal.create");
    expect(audit.map((a) => a.targetId).sort()).toEqual(ids.sort());
    expect(
      audit.find((a) => a.targetId === byAgent.body.goal.id),
    ).toMatchObject({
      actor: "agent:claude-code",
      details: { on_behalf_of: w.owner },
    });
  });

  it("assignee: an agent gets 403 agent_cannot_assign; a person may name a writer, not a viewer or an outsider", async () => {
    const w = await world(ctx.db);
    const assign = { assignee: w.editor };
    for (const c of [agent(w.owner), await runToken(w.owner, w)]) {
      expectError(await create(c, w, assign), 403, "agent_cannot_assign");
    }
    for (const who of [w.viewer, w.outsider]) {
      const res = await create(as(w.owner), w, { assignee: who });
      expectError(res, 400, "invalid_request");
      expect(res.body.error.field).toBe("assignee");
    }
    expect(await goalRows(w)).toEqual([]);
    const ok = await create(as(w.owner), w, assign);
    expect(ok.status).toBe(201);
    expect(ok.body.goal.assignee).toBe(w.editor);
  });

  it("a viewer, and a viewer run token of an owner, get 403 role_cannot_write", async () => {
    const w = await world(ctx.db);
    expectError(await create(as(w.viewer), w), 403, "role_cannot_write");
    const viewerToken = await runToken(w.owner, w, "viewer");
    expectError(await create(viewerToken, w), 403, "role_cannot_write");
    expect(await goalRows(w)).toEqual([]);
  });

  it("feature_id must belong to project_id; an unknown project is 404", async () => {
    const w = await world(ctx.db);
    const feature = (projectId: string, slug: string) =>
      seedFeature(ctx.db, { projectId, slug, name: slug });
    const fa = await feature(w.projectA, "fa");
    const fb = await feature(w.projectB, "fb");
    const ok = await create(as(w.owner), w, { feature_id: fa.id });
    expect(ok.status).toBe(201);
    expect(ok.body.goal.feature_id).toBe(fa.id);
    const wrong = await create(as(w.owner), w, { feature_id: fb.id });
    expectError(wrong, 404, "not_found");
    const unknown = await create(as(w.owner), w, { project_id: UUID });
    expectError(unknown, 404, "not_found");
    expect(await goalRows(w)).toHaveLength(1);
  });

  it("an over-cap title is 413 too_large with field title; a bad executor is 400", async () => {
    const w = await world(ctx.db);
    const res = await create(as(w.owner), w, { title: "x".repeat(201) });
    expectError(res, 413, "too_large");
    expect(res.body.error.field).toBe("title");
    const bad = await create(as(w.owner), w, { executor: "swarm" });
    expectError(bad, 400, "invalid_request");
  });

  it("a secret in the title or body is 422 secret_detected with the rule; nothing stored, no audit", async () => {
    const w = await world(ctx.db);
    for (const extra of [
      { title: `token ${pat()}` },
      { body: `use ${pat()}` },
    ]) {
      const res = await create(as(w.owner), w, extra);
      expectError(res, 422, "secret_detected");
      expect(res.body.error.rule).toBe("github-pat");
      expect(res.text).not.toContain("gh" + "p_");
    }
    expect(await goalRows(w)).toEqual([]);
    expect(await auditOf(w, "goal.create")).toEqual([]);
  });
});

describe("GET /api/v1/goals and /api/v1/goals/:id", () => {
  it("lists a project's goals newest first, for a viewer too; bad ids are 400, unknown 404", async () => {
    const w = await world(ctx.db);
    const first = await create(as(w.owner), w);
    ctx.advance(1);
    const second = await create(as(w.owner), w);
    await create(as(w.owner), w, { project_id: w.projectB });
    const list = await as(w.viewer).get(
      `/api/v1/goals?project_id=${w.projectA}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.goals.map((g: { id: string }) => g.id)).toEqual([
      second.body.goal.id,
      first.body.goal.id,
    ]);
    for (const path of ["?project_id=nope", "", "/nope"]) {
      const res = await as(w.owner).get(`/api/v1/goals${path}`);
      expectError(res, 400, "invalid_request");
    }
    const unknown = await as(w.owner).get(`/api/v1/goals/${UUID}`);
    expectError(unknown, 404, "not_found");
  });

  it("returns tasks by position with effective status, holder, depends_on, pinned and counts", async () => {
    const w = await world(ctx.db);
    const g = await seedGoal(ctx.db, {
      workspaceId: w.workspaceId,
      projectId: w.projectA,
      status: "approved",
      approvedBy: w.owner,
    });
    const task = (title: string, extra: object = {}) =>
      seedTask(ctx.db, { goalId: g.id, title, ...extra });
    const t0 = await task("zero", { status: "done" });
    const t1 = await task("one", { dependsOn: [t0.id] });
    const t2 = await task("two", { pinned: false });
    const lease = (s: number) => new Date(ctx.now().getTime() + s * 1000);
    const hold = (id: string, actor: string, seq: number, s: number) =>
      ctx.db
        .update(tasks)
        .set({
          status: "in_progress",
          holderActor: actor,
          claimSeq: seq,
          leaseExpiresAt: lease(s),
        })
        .where(eq(tasks.id, id));
    await hold(t1.id, "agent:device/x", 2, 300);
    // A lease that runs out at `now` reads pending with no holder.
    await hold(t2.id, "agent:device/y", 1, 0);

    const res = await as(w.viewer).get(`/api/v1/goals/${g.id}`);
    expect(res.status).toBe(200);
    expect(res.body.goal).toMatchObject({ id: g.id, status: "approved" });
    const got = res.body.tasks as Record<string, unknown>[];
    expect(got.map((t) => t.title)).toEqual(["zero", "one", "two"]);
    expect(got[0]).toMatchObject({
      status: "done",
      holder: null,
      depends_on: [],
      pinned: true,
      position: 0,
    });
    expect(got[1]).toMatchObject({
      status: "in_progress",
      depends_on: [t0.id],
      claim_seq: 2,
      holder: {
        actor: "agent:device/x",
        device_id: null,
        lease_expires_at: lease(300).toISOString(),
      },
    });
    expect(got[2]).toMatchObject({
      status: "pending",
      holder: null,
      pinned: false,
    });
    expect(res.body.goal.counts).toEqual({
      ...zero,
      pending: 1,
      in_progress: 1,
      done: 1,
    });
  });
});

describe("approve, cancel and release", () => {
  const actions = ["approve", "cancel", "release"];

  it("a viewer gets 403 role_cannot_write; bad ids are 400 and unknown ones 404", async () => {
    const w = await world(ctx.db);
    const g = await seedDraft(w);
    for (const action of actions) {
      const post = (who: string, id: string) =>
        as(who).post(`/api/v1/goals/${id}/${action}`);
      expectError(await post(w.viewer, g.id), 403, "role_cannot_write");
      expectError(await post(w.owner, "nope"), 400, "invalid_request");
      expectError(await post(w.owner, UUID), 404, "not_found");
    }
  });

  it("approve pins every task, sets approved_by and approved_at, and audits; again pins only new or changed text", async () => {
    const w = await world(ctx.db);
    const g = await seedDraft(w);
    const a = await seedTask(ctx.db, { goalId: g.id, title: "a" });
    await seedTask(ctx.db, { goalId: g.id, title: "b" });
    const approve = (who: string) =>
      as(who).post(`/api/v1/goals/${g.id}/approve`);
    const res = await approve(w.editor);
    expect(res.status).toBe(200);
    expect(res.body.pinned).toBe(2);
    expect(res.body.goal).toMatchObject({
      status: "approved",
      approved_by: w.editor,
      approved_at: ctx.now().toISOString(),
    });
    const rows = await ctx.db
      .select()
      .from(tasks)
      .where(eq(tasks.goalId, g.id));
    for (const t of rows) expect(t.approvedHash).toBe(t.textHash);
    expect(await auditOf(w, "goal.approve")).toMatchObject([
      {
        actor: `human:${w.editor}`,
        targetId: g.id,
        details: { from: "draft", pinned: 2 },
      },
    ]);

    // Changed text and a task added after approval are pinned by the next approve.
    await ctx.db
      .update(tasks)
      .set({ textHash: "changed" })
      .where(eq(tasks.id, a.id));
    await seedTask(ctx.db, { goalId: g.id, title: "c", pinned: false });
    const again = await approve(w.owner);
    expect(again.status).toBe(200);
    expect(again.body.pinned).toBe(2);
    expect(again.body.goal.approved_by).toBe(w.owner);
    const got = await as(w.owner).get(`/api/v1/goals/${g.id}`);
    const pinned = got.body.tasks.map((t: { pinned: boolean }) => t.pinned);
    expect(pinned).toEqual([true, true, true]);
  });

  it("approve is 409 quarantined while the goal or a task is held, and pins after release", async () => {
    const w = await world(ctx.db);
    const g = await seedDraft(w, HELD);
    await seedTask(ctx.db, { goalId: g.id });
    const post = (action: string) =>
      as(w.owner).post(`/api/v1/goals/${g.id}/${action}`);
    expectError(await post("approve"), 409, "quarantined");
    const released = await post("release");
    expect(released.status).toBe(200);
    expect(released.body.goal.quarantined_because).toBeNull();
    expect(await auditOf(w, "goal.release")).toMatchObject([
      { targetId: g.id, details: { quarantined_because: HELD } },
    ]);
    expectError(await post("release"), 409, "invalid_state");

    const held = await seedTask(ctx.db, {
      goalId: g.id,
      quarantinedBecause: HELD,
    });
    expectError(await post("approve"), 409, "quarantined");
    await ctx.db
      .update(tasks)
      .set({ quarantinedBecause: null })
      .where(eq(tasks.id, held.id));
    const ok = await post("approve");
    expect(ok.status).toBe(200);
    expect(ok.body.pinned).toBe(2);
    expect(await auditOf(w, "goal.approve")).toHaveLength(1);
  });

  it("cancel audits and is 409 invalid_state the second time; approve of a cancelled goal is 409 invalid_state", async () => {
    const w = await world(ctx.db);
    const g = await seedDraft(w, HELD);
    const post = (action: string) =>
      as(w.owner).post(`/api/v1/goals/${g.id}/${action}`);
    const res = await post("cancel");
    expect(res.status).toBe(200);
    expect(res.body.goal.status).toBe("cancelled");
    expectError(await post("cancel"), 409, "invalid_state");
    // invalid_state comes before quarantined.
    expectError(await post("approve"), 409, "invalid_state");
    expect(await auditOf(w, "goal.cancel")).toMatchObject([
      { targetId: g.id, details: { from: "draft" } },
    ]);
    expect(await auditOf(w, "goal.approve")).toEqual([]);
  });
});

describe("rate limit", () => {
  it("every board write of one actor shares one bucket: the 61st is 429 rate_limited with Retry-After", async () => {
    const w = await world(ctx.db);
    const c = as(w.owner);
    for (let i = 0; i < 30; i += 1) {
      expect((await c.post("/api/v1/goals", {})).status).toBe(400);
      expect((await c.post(`/api/v1/goals/${UUID}/cancel`)).status).toBe(404);
    }
    const res = await create(c, w);
    expectError(res, 429, "rate_limited");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await goalRows(w)).toEqual([]);
    // Another person has a bucket of their own; reads are not limited.
    expect((await create(as(w.editor), w)).status).toBe(201);
    const list = await c.get(`/api/v1/goals?project_id=${w.projectA}`);
    expect(list.status).toBe(200);
    ctx.advance(1);
    expect((await create(c, w)).status).toBe(201);
  });
});
