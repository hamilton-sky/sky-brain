// Renew, release, done and fail, fenced by claim_seq, holder and device: lease expiry, a late
// report refused, fail and its cascade, secrets withheld, events from the token (bars 3, 7;
// cloud-task-board ticket 07). Isolation and verbs: report-isolation.test.ts.
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

// Built at run time so no secret-shaped string sits in the source.
const pat = () => "gh" + "p_" + "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5";
const proof = { commit: "abc1234", summary: "all green" };

async function worker(person: string, projectId: string) {
  const d = await device(ctx.server, person);
  const { runToken } = await mintRunToken(ctx.server, d.deviceToken, {
    project_id: projectId,
    verbs: ["read", "claim", "report"],
  });
  return { client: withToken(ctx.server, runToken), deviceId: d.deviceId };
}
type Worker = Awaited<ReturnType<typeof worker>>;

const post = (c: TestClient, id: string, verb: string, body: object) =>
  c.post(`/api/v1/tasks/${id}/${verb}`, body);
const bodies = (seq: number): [string, object][] => [
  ["renew", { claim_seq: seq }],
  ["release", { claim_seq: seq }],
  ["done", { claim_seq: seq, proof }],
  ["fail", { claim_seq: seq, reason: "broke" }],
];

const claimOk = async (wk: Worker, id: string): Promise<number> =>
  (await ok(wk.client, id, "claim", {})).lease.claim_seq;

/** An approved goal in project A (approved by the editor) with these tasks, files apart. */
async function board(
  w: W,
  specs: { dependsOn?: number[]; maxAttempts?: number }[] = [{}],
) {
  const g = await seedGoal(ctx.db, {
    workspaceId: w.workspaceId,
    projectId: w.projectA,
    status: "approved",
    approvedBy: w.editor,
  });
  const ids: string[] = [];
  for (const s of specs) {
    const t = await seedTask(ctx.db, {
      goalId: g.id,
      files: [`src/t${ids.length}`],
      dependsOn: (s.dependsOn ?? []).map((i) => ids[i]!),
      ...(s.maxAttempts ? { maxAttempts: s.maxAttempts } : {}),
    });
    ids.push(t.id);
  }
  return { goalId: g.id, ids };
}

/** A world, a board in its project A, and a worker of the editor there. */
async function setup(specs?: Parameters<typeof board>[1]) {
  const w = await world(ctx.db);
  const { goalId, ids } = await board(w, specs);
  const wk = await worker(w.editor, w.projectA);
  return { w, goalId, ids, id: ids[0]!, wk };
}

const row = async (id: string) =>
  (await ctx.db.select().from(tasks).where(eq(tasks.id, id)))[0]!;
const events = (id: string) =>
  ctx.db
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, id))
    .orderBy(asc(taskEvents.seq));
const kinds = async (id: string) => (await events(id)).map((e) => e.kind);
const statusAudits = async (id: string) =>
  (
    await ctx.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, id), eq(auditLog.action, "task.status")))
      .orderBy(asc(auditLog.seq))
  ).map((a) => a.details);

/** 200, and the body. */
async function ok(c: TestClient, id: string, verb: string, body: object) {
  const res = await post(c, id, verb, body);
  expect(res.status).toBe(200);
  return res.body;
}

async function refused(
  c: TestClient,
  id: string,
  verb: string,
  body: object,
  code = "lease_lost",
) {
  expectError(await post(c, id, verb, body), 409, code);
}

describe("renew and the lease (bar 3)", () => {
  it("renew moves the lease 600 s ahead and keeps the task held past its first expiry", async () => {
    const { w, id, wk } = await setup();
    const seq = await claimOk(wk, id);
    ctx.advance(180);
    const res = await ok(wk.client, id, "renew", { claim_seq: seq });
    expect(res.lease).toEqual({
      claim_seq: seq,
      expires_at: new Date(ctx.now().getTime() + 600_000).toISOString(),
    });
    ctx.advance(500);
    const other = await worker(w.editor, w.projectA);
    await refused(other.client, id, "claim", {}, "already_claimed");
    expect(await kinds(id)).toEqual(["claimed", "renewed"]);
  });

  it("after 601 s the old holder's renew and done are lease_lost; after a new claim its done still is, the new holder's is not", async () => {
    const { w, id, wk: old } = await setup();
    await claimOk(old, id);
    ctx.advance(601);
    await refused(old.client, id, "renew", { claim_seq: 1 });
    await refused(old.client, id, "done", { claim_seq: 1, proof });
    expect(await row(id)).toMatchObject({ proof: null, status: "in_progress" });
    const fresh = await worker(w.editor, w.projectA);
    expect(await claimOk(fresh, id)).toBe(2);
    for (const s of [1, 2]) {
      await refused(old.client, id, "done", { claim_seq: s, proof });
    }
    expect(await row(id)).toMatchObject({
      holderDevice: fresh.deviceId,
      proof: null,
    });
    const done = await ok(fresh.client, id, "done", { claim_seq: 2, proof });
    expect(done.task).toMatchObject({ status: "done", holder: null, proof });
    expect(await kinds(id)).toEqual([
      "claimed",
      "reclaimed",
      "claimed",
      "done",
    ]);
  });

  it("a wrong claim_seq, a different agent and another device of the same person all get lease_lost", async () => {
    const { w, id, wk: holder } = await setup();
    const seq = await claimOk(holder, id);
    const otherDevice = await worker(w.editor, w.projectA);
    const otherAgent = ctx.server.as({
      kind: "agent",
      agent_id: "other",
      on_behalf_of: w.editor,
    });
    const cases: [TestClient, number][] = [
      [holder.client, seq + 1],
      [otherDevice.client, seq],
      [otherAgent, seq],
      [ctx.server.as(human(w.editor)), seq],
    ];
    for (const [client, s] of cases) {
      for (const [verb, body] of bodies(s)) {
        await refused(client, id, verb, body);
      }
    }
    expect(await row(id)).toMatchObject({
      status: "in_progress",
      attempts: 0,
      holderDevice: holder.deviceId,
      failReason: null,
      proof: null,
    });
    expect(await kinds(id)).toEqual(["claimed"]);
  });
});

describe("release and done", () => {
  it("release frees the task: pending, no holder, claimable again; event released", async () => {
    const { id, wk } = await setup();
    const seq = await claimOk(wk, id);
    const res = await ok(wk.client, id, "release", { claim_seq: seq });
    expect(res.task).toMatchObject({ status: "pending", holder: null });
    expect(await row(id)).toMatchObject({
      attempts: 0,
      holderActor: null,
      holderDevice: null,
    });
    expect(await claimOk(wk, id)).toBe(seq + 1);
    expect(await kinds(id)).toEqual(["claimed", "released", "claimed"]);
    expect(await statusAudits(id)).toMatchObject([
      { to: "in_progress" },
      { from: "in_progress", to: "pending", via: "release" },
      { to: "in_progress" },
    ]);
  });

  it("done stores the proof, returns newly_ready, and done twice is a harmless 200 with one event", async () => {
    const { id, ids, wk } = await setup([
      {},
      { dependsOn: [0] },
      { dependsOn: [0] },
      { dependsOn: [0, 1] },
    ]);
    const seq = await claimOk(wk, id);
    const res = await ok(wk.client, id, "done", { claim_seq: seq, proof });
    expect([...res.newly_ready].sort()).toEqual([ids[1], ids[2]].sort());
    expect((await row(id)).proof).toEqual(proof);
    const again = await ok(wk.client, id, "done", { claim_seq: seq, proof });
    expect(again.task.status).toBe("done");
    expect(await kinds(id)).toEqual(["claimed", "done"]);
    expect(await statusAudits(id)).toMatchObject([
      { from: "pending", to: "in_progress" },
      { from: "in_progress", to: "done", via: "done" },
    ]);
  });

  it("a secret in proof and in a fail reason is stored as [withheld: <rule>]", async () => {
    const { ids, wk } = await setup([{}, {}]);
    const [a, b] = ids as [string, string];
    await ok(wk.client, a, "done", {
      claim_seq: await claimOk(wk, a),
      proof: {
        gates: [{ name: "test", ok: true, summary: `token ${pat()}` }],
        summary: `pushed with ${pat()}`,
      },
    });
    const done = await row(a);
    expect(JSON.stringify(done.proof)).not.toContain(pat());
    expect(done.proof).toEqual({
      gates: [{ name: "test", ok: true, summary: "[withheld: github-pat]" }],
      summary: "[withheld: github-pat]",
    });
    const seq = await claimOk(wk, b);
    await ok(wk.client, b, "fail", { claim_seq: seq, reason: `push ${pat()}` });
    expect((await row(b)).failReason).toBe("[withheld: github-pat]");
  });
});

describe("fail", () => {
  it("fail below max_attempts adds 1 to attempts, stores the reason and returns the task to pending", async () => {
    const { id, wk } = await setup([{ maxAttempts: 3 }]);
    const seq = await claimOk(wk, id);
    const res = await ok(wk.client, id, "fail", {
      claim_seq: seq,
      reason: "tests failed",
    });
    expect(res).toMatchObject({
      task: {
        status: "pending",
        attempts: 1,
        holder: null,
        fail_reason: "tests failed",
      },
      blocked: [],
    });
    const evs = await events(id);
    expect(evs.map((e) => [e.kind, e.details])).toEqual([
      ["claimed", {}],
      ["failed", { final: false }],
    ]);
  });

  it("max_attempts 3: two expired leases then one fail leave attempts 1 and the task pending", async () => {
    const { id, wk } = await setup([{ maxAttempts: 3 }]);
    await claimOk(wk, id);
    ctx.advance(601);
    await claimOk(wk, id);
    ctx.advance(601);
    const seq = await claimOk(wk, id);
    expect(seq).toBe(3);
    const res = await ok(wk.client, id, "fail", {
      claim_seq: seq,
      reason: "x",
    });
    expect(res.task).toMatchObject({ attempts: 1, status: "pending" });
  });

  it("the fail that brings attempts to max_attempts fails the task and blocks a chain of two dependents", async () => {
    const { id, ids, wk } = await setup([
      { maxAttempts: 2 },
      { dependsOn: [0] },
      { dependsOn: [1] },
      {},
    ]);
    let seq = await claimOk(wk, id);
    await ok(wk.client, id, "fail", { claim_seq: seq, reason: "one" });
    seq = await claimOk(wk, id);
    const res = await ok(wk.client, id, "fail", {
      claim_seq: seq,
      reason: "two",
    });
    expect(res.task).toMatchObject({
      status: "failed",
      attempts: 2,
      holder: null,
    });
    expect([...res.blocked].sort()).toEqual([ids[1], ids[2]].sort());
    const statuses = await Promise.all(
      ids.map(async (t) => (await row(t)).status),
    );
    expect(statuses).toEqual(["failed", "blocked", "blocked", "pending"]);
    const failed = (await events(id)).filter((e) => e.kind === "failed");
    expect(failed.map((e) => e.details)).toEqual([
      { final: false },
      { final: true, blocked: expect.arrayContaining([ids[1], ids[2]]) },
    ]);
    for (const dep of [ids[1]!, ids[2]!]) {
      expect(await statusAudits(dep)).toMatchObject([
        { from: "pending", to: "blocked", via: "fail", failed_task: id },
      ]);
    }
    await refused(wk.client, ids[1]!, "claim", {}, "not_ready");
  });
});

describe("a cancelled goal", () => {
  it("renew and done get goal_cancelled; release and fail still free the task", async () => {
    const { w, goalId, ids, wk } = await setup([{}, {}]);
    const [a, b] = ids as [string, string];
    const seqA = await claimOk(wk, a);
    const seqB = await claimOk(wk, b);
    const cancel = await ctx.server
      .as(human(w.editor))
      .post(`/api/v1/goals/${goalId}/cancel`);
    expect(cancel.status).toBe(200);
    await refused(wk.client, a, "renew", { claim_seq: seqA }, "goal_cancelled");
    await refused(
      wk.client,
      a,
      "done",
      { claim_seq: seqA, proof },
      "goal_cancelled",
    );
    // The fence answers first: a wrong claim_seq on a cancelled goal is lease_lost.
    await refused(wk.client, a, "renew", { claim_seq: seqA + 1 });
    expect(await kinds(a)).toEqual(["claimed"]);
    const rel = await ok(wk.client, a, "release", { claim_seq: seqA });
    expect(rel.task).toMatchObject({ status: "pending", holder: null });
    const fail = await ok(wk.client, b, "fail", {
      claim_seq: seqB,
      reason: "stop",
    });
    expect(fail.task).toMatchObject({ status: "pending", holder: null });
  });
});

describe("events (bar 7)", () => {
  it("each event's actor and device are the token's", async () => {
    const { w, id, wk } = await setup();
    let seq = await claimOk(wk, id);
    await ok(wk.client, id, "renew", { claim_seq: seq });
    await ok(wk.client, id, "release", { claim_seq: seq });
    seq = await claimOk(wk, id);
    await ok(wk.client, id, "fail", { claim_seq: seq, reason: "x" });
    seq = await claimOk(wk, id);
    await ok(wk.client, id, "done", { claim_seq: seq, proof });
    const evs = await events(id);
    expect(evs.map((e) => e.kind).join(" ")).toBe(
      "claimed renewed released claimed failed claimed done",
    );
    for (const e of evs) {
      expect([e.actor, e.deviceId, e.onBehalfOf]).toEqual([
        `agent:device/${wk.deviceId}`,
        wk.deviceId,
        w.editor,
      ]);
    }
  });

  it("a body naming device_id or actor is 400 invalid_request with no event", async () => {
    const { id, wk } = await setup();
    const seq = await claimOk(wk, id);
    for (const [verb, body] of bodies(seq)) {
      for (const extra of [{ device_id: wk.deviceId }, { actor: "human:x" }]) {
        expectError(
          await post(wk.client, id, verb, { ...body, ...extra }),
          400,
          "invalid_request",
        );
      }
    }
    expect(await kinds(id)).toEqual(["claimed"]);
    expect(await row(id)).toMatchObject({ status: "in_progress", attempts: 0 });
  });
});
