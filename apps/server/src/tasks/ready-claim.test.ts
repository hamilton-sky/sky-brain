// The ready list and the claim: one winner, dependencies, which goals a person may run, lease
// expiry with the fencing number, and who an event names (bars 1, 2, 6, 7; ticket 06).
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, taskEvents, tasks } from "../db/schema.ts";
import {
  device,
  expectError,
  human,
  useRunTokenFixture,
  world,
} from "../run-tokens/tests/fixture.ts";
import type { TestClient } from "../testing/harness.ts";
import {
  mintRunToken,
  seedGoal,
  seedTask,
  withToken,
} from "../testing/task-seeds.ts";

const ctx = useRunTokenFixture();
type W = Awaited<ReturnType<typeof world>>;

const as = (person: string) => ctx.server.as(human(person));
const agent = (person: string, id = "claude-code") =>
  ctx.server.as({ kind: "agent", agent_id: id, on_behalf_of: person });
const claim = (c: TestClient, id: string) =>
  c.post(`/api/v1/tasks/${id}/claim`, {});

async function readyIds(c: TestClient, query = ""): Promise<string[]> {
  const res = await c.get(`/api/v1/tasks/ready${query}`);
  expect(res.status).toBe(200);
  return (res.body.tasks as { id: string }[]).map((t) => t.id);
}

async function worker(person: string, projectId: string) {
  const d = await device(ctx.server, person);
  const { runToken } = await mintRunToken(ctx.server, d.deviceToken, {
    project_id: projectId,
    verbs: ["read", "claim"],
  });
  return { client: withToken(ctx.server, runToken), deviceId: d.deviceId };
}

/** An approved goal in project A approved by `by` (default the editor). */
async function goal(w: W, opts: { by?: string; assignee?: string } = {}) {
  return seedGoal(ctx.db, {
    workspaceId: w.workspaceId,
    projectId: w.projectA,
    status: "approved",
    approvedBy: opts.by ?? w.editor,
    ...(opts.assignee ? { assignee: opts.assignee } : {}),
  });
}

const events = (taskId: string) =>
  ctx.db
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(asc(taskEvents.seq));

describe("the race (bar 1)", () => {
  it("ten concurrent claims from ten agents of one person: exactly one 200, nine 409 already_claimed", async () => {
    const w = await world(ctx.db);
    const t = await seedTask(ctx.db, { goalId: (await goal(w)).id });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        claim(agent(w.editor, `racer-${i}`), t.id),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const lost = results.filter((r) => r.status !== 200);
    expect(lost).toHaveLength(9);
    for (const r of lost) expectError(r, 409, "already_claimed");
    const evs = await events(t.id);
    expect(evs.map((e) => e.kind)).toEqual(["claimed"]);
    const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(row).toMatchObject({
      status: "in_progress",
      claimSeq: 1,
      attempts: 0,
    });
  });
});

describe("ready and claim", () => {
  it("a claim answers the task in progress and a lease 600 s ahead; it leaves the ready list; audit task.status", async () => {
    const w = await world(ctx.db);
    const g = await goal(w);
    const a = await seedTask(ctx.db, { goalId: g.id });
    const b = await seedTask(ctx.db, { goalId: g.id, files: ["only/b.ts"] });
    const wk = await worker(w.editor, w.projectA);
    expect(await readyIds(wk.client)).toEqual([a.id, b.id]);
    const res = await claim(wk.client, a.id);
    expect(res.status).toBe(200);
    const expires = new Date(ctx.now().getTime() + 600_000).toISOString();
    expect(res.body.lease).toEqual({ claim_seq: 1, expires_at: expires });
    expect(res.body.task).toMatchObject({
      id: a.id,
      status: "in_progress",
      claim_seq: 1,
      attempts: 0,
      holder: { device_id: wk.deviceId, lease_expires_at: expires },
    });
    expect(await readyIds(wk.client)).toEqual([b.id]);
    const audit = await ctx.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.workspaceId, w.workspaceId),
          eq(auditLog.action, "task.status"),
        ),
      );
    expect(audit).toMatchObject([
      {
        targetId: a.id,
        details: { from: "pending", to: "in_progress", via: "claim" },
      },
    ]);
  });

  it("orders by goal created_at then position, filters by goal_id, honours limit; 400 on a bad query", async () => {
    const w = await world(ctx.db);
    const g1 = await goal(w);
    const g2 = await goal(w);
    const ids: string[] = [];
    for (const g of [g1, g2]) {
      for (let i = 0; i < 2; i += 1) {
        ids.push(
          (await seedTask(ctx.db, { goalId: g.id, files: [`${g.id}/${i}`] }))
            .id,
        );
      }
    }
    const ed = as(w.editor);
    const q = `?project_id=${w.projectA}`;
    expect(await readyIds(ed, q)).toEqual(ids);
    expect(await readyIds(ed, `${q}&goal_id=${g2.id}`)).toEqual(ids.slice(2));
    expect(await readyIds(ed, `${q}&limit=3`)).toEqual(ids.slice(0, 3));
    for (const bad of [
      "",
      `${q}&limit=0`,
      `${q}&limit=101`,
      `${q}&x=1`,
      "?project_id=nope",
    ]) {
      expectError(
        await ed.get(`/api/v1/tasks/ready${bad}`),
        400,
        "invalid_request",
      );
    }
  });

  it("a task with a dependency not done is not ready and its claim is 409 not_ready (bar 2)", async () => {
    const w = await world(ctx.db);
    const g = await goal(w);
    const first = await seedTask(ctx.db, { goalId: g.id, files: ["a"] });
    const second = await seedTask(ctx.db, {
      goalId: g.id,
      files: ["b"],
      dependsOn: [first.id],
    });
    const ed = agent(w.editor);
    expect(await readyIds(ed, `?project_id=${w.projectA}`)).toEqual([first.id]);
    expectError(await claim(ed, second.id), 409, "not_ready");
    expect((await claim(ed, first.id)).status).toBe(200);
    expectError(
      await claim(agent(w.editor, "other"), second.id),
      409,
      "not_ready",
    );
    await ctx.db
      .update(tasks)
      .set({ status: "done" })
      .where(eq(tasks.id, first.id));
    expect(await readyIds(ed, `?project_id=${w.projectA}`)).toEqual([
      second.id,
    ]);
    expect((await claim(ed, second.id)).status).toBe(200);
  });

  it("draft or cancelled goals, held tasks or goals, and unpinned tasks are never ready nor claimable", async () => {
    const w = await world(ctx.db);
    const base = {
      workspaceId: w.workspaceId,
      projectId: w.projectA,
      approvedBy: w.editor,
    };
    const draft = await seedGoal(ctx.db, { ...base, status: "draft" });
    const cancelled = await seedGoal(ctx.db, { ...base, status: "cancelled" });
    const heldGoal = await seedGoal(ctx.db, {
      ...base,
      status: "approved",
      quarantinedBecause: "ignore-instructions",
    });
    const ok = await goal(w);
    const never = [
      await seedTask(ctx.db, { goalId: draft.id, pinned: true }),
      await seedTask(ctx.db, { goalId: cancelled.id, pinned: true }),
      await seedTask(ctx.db, { goalId: heldGoal.id }),
      await seedTask(ctx.db, {
        goalId: ok.id,
        quarantinedBecause: "ignore-instructions",
      }),
      await seedTask(ctx.db, { goalId: ok.id, pinned: false }),
    ];
    const changed = await seedTask(ctx.db, {
      goalId: ok.id,
      title: "as approved",
    });
    await ctx.db
      .update(tasks)
      .set({ title: "changed after approval" })
      .where(eq(tasks.id, changed.id));
    never.push(changed);
    const ed = as(w.editor);
    expect(await readyIds(ed, `?project_id=${w.projectA}`)).toEqual([]);
    expect(
      await readyIds(agent(w.editor), `?project_id=${w.projectA}`),
    ).toEqual([]);
    for (const t of never) expectError(await claim(ed, t.id), 409, "not_ready");
    const rows = await ctx.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, w.projectA));
    expect(rows.every((r) => r.status === "pending" && r.claimSeq === 0)).toBe(
      true,
    );
  });

  it("a device of P never sees or claims a task of a goal Q approved, unless P is its assignee (bar 6)", async () => {
    const w = await world(ctx.db);
    const byOwner = await seedTask(ctx.db, {
      goalId: (await goal(w, { by: w.owner })).id,
      files: ["x"],
    });
    const assigned = await seedTask(ctx.db, {
      goalId: (await goal(w, { by: w.owner, assignee: w.editor })).id,
      files: ["y"],
    });
    const wk = await worker(w.editor, w.projectA);
    expect(await readyIds(wk.client)).toEqual([assigned.id]);
    expectError(await claim(wk.client, byOwner.id), 409, "not_ready");
    expect((await claim(wk.client, assigned.id)).status).toBe(200);
    const owner = await worker(w.owner, w.projectA);
    expect(await readyIds(owner.client)).toEqual([byOwner.id]);
  });
});

describe("lease expiry and the fencing number", () => {
  it("after 601 s the task reads pending and is ready; the next claim is claim_seq 2 with reclaimed then claimed; attempts stays 0", async () => {
    const w = await world(ctx.db);
    const t = await seedTask(ctx.db, { goalId: (await goal(w)).id });
    const a = await worker(w.editor, w.projectA);
    const b = await worker(w.editor, w.projectA);
    expect((await claim(a.client, t.id)).body.lease.claim_seq).toBe(1);
    ctx.advance(300);
    expectError(await claim(b.client, t.id), 409, "already_claimed");
    ctx.advance(301);
    const got = await b.client.get(`/api/v1/tasks/${t.id}`);
    expect(got.body.task).toMatchObject({ status: "pending", holder: null });
    expect(await readyIds(b.client)).toEqual([t.id]);
    const res = await claim(b.client, t.id);
    expect(res.status).toBe(200);
    expect(res.body.lease.claim_seq).toBe(2);
    expect(res.body.task).toMatchObject({
      attempts: 0,
      holder: { device_id: b.deviceId },
    });
    const evs = await events(t.id);
    expect(evs.map((e) => [e.kind, e.claimSeq])).toEqual([
      ["claimed", 1],
      ["reclaimed", 2],
      ["claimed", 2],
    ]);
    expect(evs[1]!.details).toEqual({
      from_actor: `agent:device/${a.deviceId}`,
      from_device: a.deviceId,
      from_claim_seq: 1,
    });
    // Bar 7: every event's actor and device are the token's.
    expect(evs.map((e) => [e.actor, e.deviceId, e.onBehalfOf])).toEqual([
      [`agent:device/${a.deviceId}`, a.deviceId, w.editor],
      [`agent:device/${b.deviceId}`, b.deviceId, w.editor],
      [`agent:device/${b.deviceId}`, b.deviceId, w.editor],
    ]);
    const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(row).toMatchObject({
      attempts: 0,
      holderDevice: b.deviceId,
      holderPerson: w.editor,
    });
  });

  it("a body naming an actor or device is 400 invalid_request and writes no event", async () => {
    const w = await world(ctx.db);
    const t = await seedTask(ctx.db, { goalId: (await goal(w)).id });
    const wk = await worker(w.editor, w.projectA);
    for (const body of [{ actor: "human:x" }, { device_id: wk.deviceId }]) {
      expectError(
        await wk.client.post(`/api/v1/tasks/${t.id}/claim`, body),
        400,
        "invalid_request",
      );
    }
    expectError(
      await wk.client.post("/api/v1/tasks/nope/claim", {}),
      400,
      "invalid_request",
    );
    expect(await events(t.id)).toEqual([]);
  });

  it("a viewer gets 403 role_cannot_write; an unknown task 404", async () => {
    const w = await world(ctx.db);
    const t = await seedTask(ctx.db, {
      goalId: (await goal(w, { assignee: w.viewer })).id,
    });
    expectError(await claim(as(w.viewer), t.id), 403, "role_cannot_write");
    expectError(
      await claim(as(w.editor), "11111111-2222-4333-8444-555555555555"),
      404,
      "not_found",
    );
    expect(await events(t.id)).toEqual([]);
  });
});
