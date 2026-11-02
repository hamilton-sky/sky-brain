// Story: A worker pulls, claims and reports (renew, release, done, fail, events).
// Bar items 3 and 7.
import { describe, expect, it } from "vitest";
import {
  approvedGoal,
  claim,
  claimOk,
  events,
  expectError,
  expectStatus,
  getTask,
  githubPat,
  human,
  loginDevice,
  proof,
  readyIds,
  setup,
  world,
  worker,
  workerFor,
  type Worker,
} from "./helpers.ts";

const ctx = setup();
const post = (wk: Worker, taskId: string, verb: string, body: unknown) =>
  wk.client.post(`/api/v1/tasks/${taskId}/${verb}`, body);
const bodies = (seq: number): [string, Record<string, unknown>][] => [
  ["renew", { claim_seq: seq }],
  ["release", { claim_seq: seq }],
  ["done", { claim_seq: seq, proof: proof() }],
  ["fail", { claim_seq: seq, reason: "broke" }],
];

describe("fencing", () => {
  // "Renew, release, done and fail must send the lease's `claim_seq` and come from the same
  // actor and device that claimed; otherwise, and after the lease expired, they get 409
  // `lease_lost`. ..."
  it("renew, release, done and fail with the wrong claim_seq get 409 lease_lost", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    for (const [verb, body] of bodies(seq + 1)) {
      expectError(await post(wk, tasks[0].id, verb, body), 409, "lease_lost");
    }
    const t = await getTask(wk.client, tasks[0].id);
    expect(t.status).toBe("in_progress");
    expect(t.attempts).toBe(0);
  });

  it("renew, release, done and fail from another device of the same person get 409 lease_lost", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const holder = await worker(ctx, w.editor, w.projectId);
    const other = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(holder, tasks[0].id);
    for (const [verb, body] of bodies(seq)) {
      expectError(await post(other, tasks[0].id, verb, body), 409, "lease_lost");
    }
    const t = await getTask(holder.client, tasks[0].id);
    expect(t.status).toBe("in_progress");
    expect(t.holder.device_id).toBe(holder.deviceId);
  });

  it("the same device with a fresh run token is still the holder", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const d = await loginDevice(ctx, w.editor);
    const first = await workerFor(ctx, d, w.projectId);
    const seq = await claimOk(first, tasks[0].id);
    const second = await workerFor(ctx, d, w.projectId);
    expectStatus(await post(second, tasks[0].id, "renew", { claim_seq: seq }), 200);
  });

  it("a person who did not claim gets 409 lease_lost on renew, release, done and fail", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const holder = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(holder, tasks[0].id);
    const person = ctx.server.as(human(w.editor));
    for (const [verb, body] of bodies(seq)) {
      expectError(await person.post(`/api/v1/tasks/${tasks[0].id}/${verb}`, body), 409, "lease_lost");
    }
  });

  it.each(["renew", "release", "done", "fail"])(
    "%s after the lease expired gets 409 lease_lost",
    async (verb) => {
      const w = await world(ctx.db);
      const { tasks } = await approvedGoal(ctx, w, [{}]);
      const wk = await worker(ctx, w.editor, w.projectId);
      const seq = await claimOk(wk, tasks[0].id);
      ctx.advance(601);
      const body = bodies(seq).find(([v]) => v === verb)![1];
      expectError(await post(wk, tasks[0].id, verb, body), 409, "lease_lost");
      const t = await getTask(wk.client, tasks[0].id);
      expect(t.status).toBe("pending");
      expect(t.attempts).toBe(0);
    },
  );

  // Edge: "Done after the lease expired and nobody claimed yet | 409 `lease_lost` (the lease is
  // gone even though the row still says in progress)"
  it("done after the lease expired and nobody claimed yet gets 409 lease_lost; nothing stored", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    ctx.advance(600);
    expectError(await post(wk, tasks[0].id, "done", { claim_seq: seq, proof: proof() }), 409, "lease_lost");
    const t = await getTask(wk.client, tasks[0].id);
    expect(t.status).toBe("pending");
    expect(t.proof).toBeNull();
    const kinds = (await events(ctx.db, tasks[0].id)).map((e) => e.kind);
    expect(kinds.filter((k) => k !== "created")).toEqual(["claimed"]);
  });

  // Edge: "Done after the lease expired and someone else claimed | 409 `lease_lost`; the new
  // holder is untouched"
  it("done after the lease expired and someone else claimed gets 409 lease_lost; the new holder is untouched", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const old = await worker(ctx, w.editor, w.projectId);
    await claimOk(old, tasks[0].id);
    ctx.advance(601);
    const fresh = await worker(ctx, w.editor, w.projectId);
    const seq2 = await claimOk(fresh, tasks[0].id);
    expect(seq2).toBe(2);
    for (const s of [1, 2]) {
      expectError(await post(old, tasks[0].id, "done", { claim_seq: s, proof: proof() }), 409, "lease_lost");
    }
    const t = await getTask(fresh.client, tasks[0].id);
    expect(t.status).toBe("in_progress");
    expect(t.claim_seq).toBe(2);
    expect(t.holder.device_id).toBe(fresh.deviceId);
    expect(t.proof).toBeNull();
    expectStatus(await post(fresh, tasks[0].id, "done", { claim_seq: 2, proof: proof() }), 200);
  });
});

describe("renew and release", () => {
  it("renew moves the lease to 600 seconds from now and keeps the task held past its first expiry", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    ctx.advance(180);
    const res = await post(wk, tasks[0].id, "renew", { claim_seq: seq });
    expectStatus(res, 200);
    expect(res.body.lease.claim_seq).toBe(seq);
    expect(Date.parse(res.body.lease.expires_at)).toBe(ctx.t.getTime() + 600_000);
    ctx.advance(500);
    const t = await getTask(wk.client, tasks[0].id);
    expect(t.status).toBe("in_progress");
    const other = await worker(ctx, w.editor, w.projectId);
    expectError(await claim(other, tasks[0].id), 409, "already_claimed");
  });

  it("release gives the task back: pending, no holder, ready again, attempts unchanged", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    const res = await post(wk, tasks[0].id, "release", { claim_seq: seq });
    expectStatus(res, 200);
    expect(res.body.task.status).toBe("pending");
    expect(res.body.task.holder).toBeNull();
    expect(res.body.task.attempts).toBe(0);
    expect(await readyIds(wk.client)).toContain(tasks[0].id);
  });

  // "... Renew and done on a cancelled goal get 409 `goal_cancelled`."
  // Edge: "Goal cancelled while a task runs | the next renew or done gets 409 `goal_cancelled`;
  // fail and release still free the task"
  it("renew and done on a cancelled goal get 409 goal_cancelled; release still frees the task", async () => {
    const w = await world(ctx.db);
    const { goal, tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    expectStatus(await ctx.server.as(human(w.editor)).post(`/api/v1/goals/${goal.id}/cancel`), 200);
    expectError(await post(wk, tasks[0].id, "renew", { claim_seq: seq }), 409, "goal_cancelled");
    expectError(await post(wk, tasks[0].id, "done", { claim_seq: seq, proof: proof() }), 409, "goal_cancelled");
    expect((await getTask(wk.client, tasks[0].id)).status).toBe("in_progress");
    const rel = await post(wk, tasks[0].id, "release", { claim_seq: seq });
    expectStatus(rel, 200);
    expect(rel.body.task.status).toBe("pending");
    expect(rel.body.task.holder).toBeNull();
  });

  it("fail on a cancelled goal still frees the task", async () => {
    const w = await world(ctx.db);
    const { goal, tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    expectStatus(await ctx.server.as(human(w.editor)).post(`/api/v1/goals/${goal.id}/cancel`), 200);
    const res = await post(wk, tasks[0].id, "fail", { claim_seq: seq, reason: "stopped" });
    expectStatus(res, 200);
    expect(res.body.task.holder).toBeNull();
    expect(res.body.task.status).not.toBe("in_progress");
  });
});

describe("done", () => {
  // "Done stores the proof (gate results, commit, PR link, summary) and returns the ids that
  // became ready; done again with the same `claim_seq` from the same holder is a harmless 200."
  it("done stores the proof and returns the ids that became ready", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [
      {},
      { depends_on: [0] },
      { depends_on: [0] },
      { depends_on: [0, 1] },
    ]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    const p = proof();
    const res = await post(wk, tasks[0].id, "done", { claim_seq: seq, proof: p });
    expectStatus(res, 200);
    expect(res.body.task.status).toBe("done");
    expect(res.body.task.holder).toBeNull();
    expect([...res.body.newly_ready].sort()).toEqual([tasks[1].id, tasks[2].id].sort());
    const t = await getTask(wk.client, tasks[0].id);
    expect(t.status).toBe("done");
    expect(t.proof).toEqual(p);
    expect((await readyIds(wk.client)).sort()).toEqual([tasks[1].id, tasks[2].id].sort());
  });

  // Edge: "Done twice by the same holder with the same `claim_seq` | 200, no second event"
  it("done again with the same claim_seq from the same holder is a harmless 200 with no second event", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    expectStatus(await post(wk, tasks[0].id, "done", { claim_seq: seq, proof: proof() }), 200);
    const again = await post(wk, tasks[0].id, "done", { claim_seq: seq, proof: proof() });
    expectStatus(again, 200);
    expect(again.body.task.status).toBe("done");
    const kinds = (await events(ctx.db, tasks[0].id)).map((e) => e.kind);
    expect(kinds.filter((k) => k === "done")).toHaveLength(1);
  });

  // "A secret in a fail reason or in proof is stored as `[withheld: <rule>]`."
  it("a secret in proof is stored as [withheld: <rule>]", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    const secret = githubPat();
    const res = await post(wk, tasks[0].id, "done", {
      claim_seq: seq,
      proof: {
        gates: [{ name: "test", ok: true, summary: `token ${secret}` }],
        summary: `pushed with ${secret}`,
      },
    });
    expectStatus(res, 200);
    const t = await getTask(wk.client, tasks[0].id);
    expect(JSON.stringify(t.proof)).not.toContain(secret);
    expect(t.proof.summary).toContain("[withheld: github-pat]");
    expect(t.proof.gates[0].summary).toContain("[withheld: github-pat]");
  });
});

describe("fail", () => {
  // "Fail stores the reason and adds 1 to `attempts`; the task goes back to `pending` while the
  // new `attempts` is below `max_attempts`, else it becomes `failed` and every task that depends
  // on it, directly or not, becomes `blocked`, all in one transaction."
  it("fail stores the reason, adds 1 to attempts and puts the task back to pending below max_attempts", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{ max_attempts: 3 }]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    const res = await post(wk, tasks[0].id, "fail", { claim_seq: seq, reason: "tests failed" });
    expectStatus(res, 200);
    expect(res.body.task.status).toBe("pending");
    expect(res.body.task.attempts).toBe(1);
    expect(res.body.blocked).toEqual([]);
    const t = await getTask(wk.client, tasks[0].id);
    expect(t.fail_reason).toBe("tests failed");
    expect(t.attempts).toBe(1);
    expect(await readyIds(wk.client)).toContain(tasks[0].id);
  });

  // Edge: "Fail that brings `attempts` to `max_attempts` | task `failed`; transitive dependents
  // `blocked`; one transaction"
  it("fail that brings attempts to max_attempts makes the task failed and every transitive dependent blocked", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [
      { max_attempts: 2 },
      { depends_on: [0] },
      { depends_on: [1] },
      {},
    ]);
    const wk = await worker(ctx, w.editor, w.projectId);
    let seq = await claimOk(wk, tasks[0].id);
    expectStatus(await post(wk, tasks[0].id, "fail", { claim_seq: seq, reason: "one" }), 200);
    seq = await claimOk(wk, tasks[0].id);
    const res = await post(wk, tasks[0].id, "fail", { claim_seq: seq, reason: "two" });
    expectStatus(res, 200);
    expect(res.body.task.status).toBe("failed");
    expect(res.body.task.attempts).toBe(2);
    expect([...res.body.blocked].sort()).toEqual([tasks[1].id, tasks[2].id].sort());
    const read = await Promise.all(tasks.map((t) => getTask(wk.client, t.id)));
    expect(read.map((t) => t.status)).toEqual(["failed", "blocked", "blocked", "pending"]);
    expectError(await claim(wk, tasks[0].id), 409, "not_ready");
    expectError(await claim(wk, tasks[1].id), 409, "not_ready");
    const failed = (await events(ctx.db, tasks[0].id)).filter((e) => e.kind === "failed");
    expect(failed).toHaveLength(2);
    expect(failed[1].details).toMatchObject({ final: true });
    expect([...failed[1].details.blocked].sort()).toEqual([tasks[1].id, tasks[2].id].sort());
  });

  // Edge: "`max_attempts` 3: two leases expire, then one fail | `attempts` 1, task back to
  // `pending`, not `failed`"
  it("max_attempts 3: two leases expire, then one fail leaves attempts 1 and the task pending", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{ max_attempts: 3 }]);
    const d = await loginDevice(ctx, w.editor);
    let wk = await workerFor(ctx, d, w.projectId);
    await claimOk(wk, tasks[0].id);
    ctx.advance(601);
    await claimOk(wk, tasks[0].id);
    ctx.advance(601);
    wk = await workerFor(ctx, d, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    expect(seq).toBe(3);
    const res = await post(wk, tasks[0].id, "fail", { claim_seq: seq, reason: "x" });
    expectStatus(res, 200);
    expect(res.body.task.attempts).toBe(1);
    expect(res.body.task.status).toBe("pending");
  });

  // "A secret in a fail reason or in proof is stored as `[withheld: <rule>]`."
  it("a secret in a fail reason is stored as [withheld: <rule>]", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    const secret = githubPat();
    expectStatus(
      await post(wk, tasks[0].id, "fail", { claim_seq: seq, reason: `push failed with ${secret}` }),
      200,
    );
    const t = await getTask(wk.client, tasks[0].id);
    expect(t.fail_reason).not.toContain(secret);
    expect(t.fail_reason).toContain("[withheld: github-pat]");
  });
});

describe("events", () => {
  // "Every claim, renew, release, done, fail and reclaim adds a `task_events` row whose actor
  // and device come from the token; ..."
  // Bar 7: "actor and device on every task event come from the token, never the body"
  it("every claim, renew, release, done, fail and reclaim adds a task_events row with actor and device from the token", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}, {}]);
    const a = await worker(ctx, w.editor, w.projectId);
    let seq = await claimOk(a, tasks[0].id);
    expectStatus(await post(a, tasks[0].id, "renew", { claim_seq: seq }), 200);
    expectStatus(await post(a, tasks[0].id, "release", { claim_seq: seq }), 200);
    seq = await claimOk(a, tasks[0].id);
    expectStatus(await post(a, tasks[0].id, "fail", { claim_seq: seq, reason: "x" }), 200);
    seq = await claimOk(a, tasks[0].id);
    expectStatus(await post(a, tasks[0].id, "done", { claim_seq: seq, proof: proof() }), 200);
    await claimOk(a, tasks[1].id);
    ctx.advance(601);
    const b = await worker(ctx, w.editor, w.projectId);
    await claimOk(b, tasks[1].id);

    const ev0 = await events(ctx.db, tasks[0].id);
    const kinds0 = ev0.map((e) => e.kind).filter((k) => k !== "created");
    expect(kinds0).toEqual(["claimed", "renewed", "released", "claimed", "failed", "claimed", "done"]);
    for (const e of ev0.filter((x) => x.kind !== "created")) {
      expect(e.actor).toBe(a.actor);
      expect(e.device_id).toBe(a.deviceId);
      expect(e.on_behalf_of).toBe(w.editor);
      expect(e.workspace_id).toBe(w.workspaceId);
    }
    const ev1 = (await events(ctx.db, tasks[1].id)).filter((x) => x.kind !== "created");
    expect(ev1.map((e) => e.kind)).toEqual(["claimed", "reclaimed", "claimed"]);
    expect(ev1[1].actor).toBe(b.actor);
    expect(ev1[1].device_id).toBe(b.deviceId);
    expect(ev1[2].device_id).toBe(b.deviceId);
  });

  // "... a body naming an actor or device is refused 400 `invalid_request` and adds no row."
  it.each([
    ["claim", (_s: number, extra: object) => ({ ...extra })],
    ["renew", (s: number, extra: object) => ({ claim_seq: s, ...extra })],
    ["done", (s: number, extra: object) => ({ claim_seq: s, proof: proof(), ...extra })],
    ["fail", (s: number, extra: object) => ({ claim_seq: s, reason: "x", ...extra })],
    ["release", (s: number, extra: object) => ({ claim_seq: s, ...extra })],
  ])("a %s body naming an actor or device is refused 400 invalid_request and adds no row", async (verb, make) => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = verb === "claim" ? 0 : await claimOk(wk, tasks[0].id);
    const before = (await events(ctx.db, tasks[0].id)).length;
    for (const extra of [
      { actor: `human:${w.owner}` },
      { device_id: "7f1c7a2e-1b7e-4c55-9d7e-2f0a3c1b5d99" },
      { actor: { kind: "human", user_id: w.owner } },
    ]) {
      expectError(await post(wk, tasks[0].id, verb, make(seq, extra)), 400, "invalid_request");
    }
    expect(await events(ctx.db, tasks[0].id)).toHaveLength(before);
    const t = await getTask(wk.client, tasks[0].id);
    expect(t.status).toBe(verb === "claim" ? "pending" : "in_progress");
  });
});
