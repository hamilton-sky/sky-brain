// Story: A worker pulls, claims and reports (ready, claim, file overlap, lease expiry).
// Bar items 1, 2, 3, 5 and 6.
import { describe, expect, it } from "vitest";
import {
  addTasks,
  approve,
  approvedGoal,
  claim,
  claimOk,
  createGoal,
  events,
  expectError,
  expectStatus,
  getTask,
  human,
  loginDevice,
  proof,
  readyIds,
  setup,
  world,
  worker,
  workerFor,
} from "./helpers.ts";

const ctx = setup();

describe("ready", () => {
  // "`GET /api/v1/tasks/ready` lists only `pending` tasks whose dependencies are all `done`,
  // under an `approved` goal whose `approved_by` or `assignee` is the caller's person, with no held
  // text and with its pinned text unchanged, in the caller's workspace (and the run token's
  // project)."
  it("lists only pending tasks with done dependencies under approved goals the caller's person approved or is assigned", async () => {
    const w = await world(ctx.db);
    const mine = await approvedGoal(ctx, w, [{}, { depends_on: [0] }]);
    const others = await approvedGoal(ctx, w, [{}], { person: w.owner });
    const assigned = await approvedGoal(ctx, w, [{}], {
      person: w.owner,
      extra: { assignee: w.editor },
    });
    const ed = ctx.server.as(human(w.editor));
    const draft = await createGoal(ed, w.projectId);
    const [draftTask] = await addTasks(ed, draft.id, [{}]);
    const otherProject = await approvedGoal(ctx, w, [{}], { projectId: w.projectId2 });

    const wk = await worker(ctx, w.editor, w.projectId);
    const ready = await readyIds(wk.client);
    expect(ready.sort()).toEqual([mine.tasks[0].id, assigned.tasks[0].id].sort());
    expect(ready).not.toContain(mine.tasks[1].id);
    expect(ready).not.toContain(others.tasks[0].id);
    expect(ready).not.toContain(draftTask.id);
    expect(ready).not.toContain(otherProject.tasks[0].id);

    const ownerWk = await worker(ctx, w.owner, w.projectId);
    const ownerReady = await readyIds(ownerWk.client);
    expect(ownerReady).toContain(others.tasks[0].id);
    expect(ownerReady).toContain(assigned.tasks[0].id);
    expect(ownerReady).not.toContain(mine.tasks[0].id);

    const humanReady = await readyIds(ed, `?project_id=${w.projectId}`);
    expect(humanReady.sort()).toEqual(ready.sort());
  });

  it("a claimed task leaves the ready list, and a dependent becomes ready once its dependency is done", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}, { depends_on: [0] }]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    const during = await readyIds(wk.client);
    expect(during).not.toContain(tasks[0].id);
    expect(during).not.toContain(tasks[1].id);
    expectStatus(
      await wk.client.post(`/api/v1/tasks/${tasks[0].id}/done`, { claim_seq: seq, proof: proof() }),
      200,
    );
    expect(await readyIds(wk.client)).toEqual([tasks[1].id]);
  });
});

describe("claim", () => {
  // "`POST /api/v1/tasks/:id/claim` on a ready task returns 200 with the task `in_progress`
  // and a lease `{claim_seq, expires_at}` 600 seconds ahead; ..."
  it("claiming a ready task returns 200, the task in_progress and a lease 600 seconds ahead", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const res = await claim(wk, tasks[0].id);
    expectStatus(res, 200);
    expect(res.body.task.id).toBe(tasks[0].id);
    expect(res.body.task.status).toBe("in_progress");
    expect(res.body.lease.claim_seq).toBe(1);
    expect(Date.parse(res.body.lease.expires_at)).toBe(ctx.t.getTime() + 600_000);
    const got = await getTask(wk.client, tasks[0].id);
    expect(got.status).toBe("in_progress");
    expect(got.holder.device_id).toBe(wk.deviceId);
    expect(Date.parse(got.holder.lease_expires_at)).toBe(ctx.t.getTime() + 600_000);
  });

  // "... when several workers race for one task exactly one gets 200 and the others 409
  // `already_claimed`."
  // Bar 1: "two workers racing to claim one ready task: exactly one wins"
  it("when several workers race for one task exactly one gets 200 and the others 409 already_claimed", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}], { extra: { assignee: w.owner } });
    const workers = [
      await worker(ctx, w.editor, w.projectId),
      await worker(ctx, w.editor, w.projectId),
      await worker(ctx, w.owner, w.projectId),
      await worker(ctx, w.owner, w.projectId),
    ];
    const results = await Promise.all(workers.map((wk) => claim(wk, tasks[0].id)));
    const wins = results.filter((r) => r.status === 200);
    expect(wins).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) {
      expectError(r, 409, "already_claimed");
    }
    const claimed = (await events(ctx.db, tasks[0].id)).filter((e) => e.kind === "claimed");
    expect(claimed).toHaveLength(1);
  });

  it("a second claim of a task held with a live lease gets 409 already_claimed", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const a = await worker(ctx, w.editor, w.projectId);
    const b = await worker(ctx, w.editor, w.projectId);
    await claimOk(a, tasks[0].id);
    ctx.advance(300);
    expectError(await claim(b, tasks[0].id), 409, "already_claimed");
  });

  // "A claim of a task that is not ready (a dependency not done, a draft or cancelled goal, a
  // goal the person may not run, held or unpinned text) gets 409 `not_ready`."
  // Bar 2: "a task with an unfinished dependency is never ready and cannot be claimed"
  it("a task whose dependency is not done gets 409 not_ready, also while the dependency is in progress", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}, { depends_on: [0] }, { depends_on: [1] }]);
    const wk = await worker(ctx, w.editor, w.projectId);
    expectError(await claim(wk, tasks[1].id), 409, "not_ready");
    await claimOk(wk, tasks[0].id);
    const other = await worker(ctx, w.editor, w.projectId);
    expectError(await claim(other, tasks[1].id), 409, "not_ready");
    expectError(await claim(other, tasks[2].id), 409, "not_ready");
    expect((await getTask(wk.client, tasks[1].id)).status).toBe("pending");
  });

  // Bar 6: "a device never gets a task from a goal it may not run"
  it("a goal the person may not run (approved by someone else, not assigned) gets 409 not_ready and never shows as ready", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}], { person: w.owner });
    const wk = await worker(ctx, w.editor, w.projectId);
    expect(await readyIds(wk.client)).not.toContain(tasks[0].id);
    expectError(await claim(wk, tasks[0].id), 409, "not_ready");
    expect((await getTask(wk.client, tasks[0].id)).status).toBe("pending");
  });

  it("draft and cancelled goals and unpinned text get 409 not_ready", async () => {
    const w = await world(ctx.db);
    const ed = ctx.server.as(human(w.editor));
    const draft = await createGoal(ed, w.projectId);
    const [d1] = await addTasks(ed, draft.id, [{}]);
    const cancelled = await approvedGoal(ctx, w, [{}]);
    expectStatus(await ed.post(`/api/v1/goals/${cancelled.goal.id}/cancel`), 200);
    const approvedThenAdded = await approvedGoal(ctx, w, [{}]);
    const [unpinned] = await addTasks(ed, approvedThenAdded.goal.id, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    for (const id of [d1.id, cancelled.tasks[0].id, unpinned.id]) {
      expectError(await claim(wk, id), 409, "not_ready");
    }
  });
});

describe("files", () => {
  // "A claim whose task's `files` overlap a task in progress with a live lease in the same
  // project gets 409 `files_busy`; `files: null` or `[]` overlaps everything."
  // Bar 5: "two tasks with overlapping files never run at once"
  it("a task whose files overlap an in-progress task (equal path or folder of it) gets 409 files_busy", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [
      { files: ["src/a"] },
      { files: ["src/a/b.ts"] },
      { files: ["src/a"] },
      { files: ["docs/x.md", "src"] },
    ]);
    const a = await worker(ctx, w.editor, w.projectId);
    const b = await worker(ctx, w.editor, w.projectId);
    await claimOk(a, tasks[0].id);
    for (const t of tasks.slice(1)) {
      expectError(await claim(b, t.id), 409, "files_busy");
      expect((await getTask(b.client, t.id)).status).toBe("pending");
    }
  });

  it("tasks whose files do not overlap run at once, also in another project", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{ files: ["src/a"] }, { files: ["src/ab.ts", "lib"] }]);
    const elsewhere = await approvedGoal(ctx, w, [{ files: null }], { projectId: w.projectId2 });
    const a = await worker(ctx, w.editor, w.projectId);
    const b = await worker(ctx, w.editor, w.projectId);
    await claimOk(a, tasks[0].id);
    expectStatus(await claim(b, tasks[1].id), 200);
    const c = await worker(ctx, w.editor, w.projectId2);
    expectStatus(await claim(c, elsewhere.tasks[0].id), 200);
  });

  it.each([
    ["null", null],
    ["[]", []],
  ])("files %s overlaps everything, both ways", async (_label, files) => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [
      { files: files as string[] | null },
      { files: ["zzz/only-here.ts"] },
      { files: ["yyy/only-here.ts"] },
      { files: files as string[] | null },
    ]);
    const a = await worker(ctx, w.editor, w.projectId);
    const b = await worker(ctx, w.editor, w.projectId);
    await claimOk(a, tasks[1].id);
    expectError(await claim(b, tasks[0].id), 409, "files_busy");
    expectStatus(
      await a.client.post(`/api/v1/tasks/${tasks[1].id}/release`, { claim_seq: 1 }),
      200,
    );
    await claimOk(a, tasks[3].id);
    expectError(await claim(b, tasks[2].id), 409, "files_busy");
  });

  it("an in-progress task whose lease expired no longer blocks overlapping files", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{ files: ["src"] }, { files: ["src/x.ts"] }]);
    const a = await worker(ctx, w.editor, w.projectId);
    const b = await worker(ctx, w.editor, w.projectId);
    await claimOk(a, tasks[0].id);
    ctx.advance(601);
    expectStatus(await claim(b, tasks[1].id), 200);
  });

  // Edge: "Two claims in one project whose files overlap, at the same moment | the per-project
  // advisory lock serializes them; one wins, one gets `files_busy`"
  it("two claims in one project whose files overlap at the same moment: one wins, one gets files_busy", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{ files: ["src/a.ts"] }, { files: ["src"] }]);
    const a = await worker(ctx, w.editor, w.projectId);
    const b = await worker(ctx, w.editor, w.projectId);
    const [ra, rb] = await Promise.all([claim(a, tasks[0].id), claim(b, tasks[1].id)]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 409]);
    expectError(ra.status === 409 ? ra : rb, 409, "files_busy");
  });
});

describe("lease expiry", () => {
  // "A lease not renewed for 600 seconds returns the task to `pending` by itself: reads show
  // it `pending` with no holder, it is ready again, and the next claim writes a `reclaimed` event."
  // Bar 3: "an expired lease returns the task to pending, and the old holder's done is refused"
  it("a lease not renewed for 600 seconds reads pending with no holder, is ready again, and the next claim writes reclaimed", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const d1 = await loginDevice(ctx, w.editor);
    const d2 = await loginDevice(ctx, w.editor);
    const a = await workerFor(ctx, d1, w.projectId);
    await claimOk(a, tasks[0].id);
    ctx.advance(600);
    const b = await workerFor(ctx, d2, w.projectId);
    const t = await getTask(b.client, tasks[0].id);
    expect(t.status).toBe("pending");
    expect(t.holder).toBeNull();
    expect(await readyIds(b.client)).toContain(tasks[0].id);
    const res = await claim(b, tasks[0].id);
    expectStatus(res, 200);
    expect(res.body.lease.claim_seq).toBe(2);
    const evs = (await events(ctx.db, tasks[0].id)).filter((e) => e.kind !== "created");
    expect(evs.map((e) => e.kind)).toEqual(["claimed", "reclaimed", "claimed"]);
    const reclaimed = evs[1];
    expect(reclaimed.actor).toBe(b.actor);
    expect(reclaimed.device_id).toBe(b.deviceId);
    expect(reclaimed.details).toMatchObject({
      from_actor: a.actor,
      from_device: a.deviceId,
      from_claim_seq: 1,
    });
    expectError(
      await a.client.post(`/api/v1/tasks/${tasks[0].id}/done`, { claim_seq: 1, proof: proof() }),
      409,
      "lease_lost",
    );
  });

  // "A claim, and a takeover after an expired lease, leave `attempts` unchanged; only fail
  // adds 1 to it."
  // Edge: "Lease expired, any number of times | returns to pending; `attempts` unchanged (only
  // fail counts)"
  it("a claim and any number of takeovers after an expired lease leave attempts unchanged", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{ max_attempts: 2 }]);
    const devices = [await loginDevice(ctx, w.editor), await loginDevice(ctx, w.editor)];
    for (let i = 0; i < 4; i += 1) {
      // A fresh run token each round: the clock moves past a token's 30 minutes.
      const a = await workerFor(ctx, devices[i % 2]!, w.projectId);
      const res = await claim(a, tasks[0].id);
      expectStatus(res, 200);
      expect(res.body.task.attempts).toBe(0);
      expect(res.body.lease.claim_seq).toBe(i + 1);
      ctx.advance(601);
      const t = await getTask(a.client, tasks[0].id);
      expect(t.status).toBe("pending");
      expect(t.attempts).toBe(0);
    }
    const kinds = (await events(ctx.db, tasks[0].id)).map((e) => e.kind);
    expect(kinds.filter((k) => k === "reclaimed")).toHaveLength(3);
  });
});
