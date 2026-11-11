// Bar item 4: "workspace B cannot read, claim or complete workspace A's tasks through any route."
import { describe, expect, it } from "vitest";
import {
  agent,
  approvedGoal,
  claimOk,
  events,
  getTask,
  human,
  loginDevice,
  mint,
  proof,
  readyIds,
  setup,
  taskBody,
  world,
  worker,
  type Client,
  type World,
  type Worker,
} from "./helpers.ts";

const ctx = setup();
let a: World;
let b: World;
let goalId: string;
let taskIds: string[];
let holder: Worker;
let seq: number;

let ready: Promise<void> | undefined;
/** A's board, built once by the first test that needs it (so a failure fails each test). */
function boardOfA(): Promise<void> {
  ready ??= (async () => {
    a = await world(ctx.db);
    b = await world(ctx.db);
    const made = await approvedGoal(ctx, a, [{}, {}]);
    goalId = made.goal.id;
    taskIds = made.tasks.map((t) => t.id);
    holder = await worker(ctx, a.editor, a.projectId);
    seq = await claimOk(holder, taskIds[1]!);
  })();
  return ready;
}

/** Every task and goal route, with A's ids. */
function attempts(c: Client): [string, Promise<any>][] {
  const [free, held] = taskIds as [string, string];
  return [
    ["list goals", c.get(`/api/v1/goals?project_id=${a.projectId}`)],
    ["get goal", c.get(`/api/v1/goals/${goalId}`)],
    ["ready", c.get(`/api/v1/tasks/ready?project_id=${a.projectId}`)],
    ["get task", c.get(`/api/v1/tasks/${free}`)],
    ["add tasks", c.post(`/api/v1/goals/${goalId}/tasks`, { tasks: [taskBody()] })],
    ["approve", c.post(`/api/v1/goals/${goalId}/approve`)],
    ["cancel", c.post(`/api/v1/goals/${goalId}/cancel`)],
    ["release goal", c.post(`/api/v1/goals/${goalId}/release`)],
    ["release text", c.post(`/api/v1/tasks/${free}/release-text`)],
    ["claim", c.post(`/api/v1/tasks/${free}/claim`, {})],
    ["renew", c.post(`/api/v1/tasks/${held}/renew`, { claim_seq: seq })],
    ["release", c.post(`/api/v1/tasks/${held}/release`, { claim_seq: seq })],
    ["done", c.post(`/api/v1/tasks/${held}/done`, { claim_seq: seq, proof: proof() })],
    ["fail", c.post(`/api/v1/tasks/${held}/fail`, { claim_seq: seq, reason: "x" })],
    [
      "create goal",
      c.post("/api/v1/goals", {
        project_id: a.projectId,
        title: "G",
        body: "b",
        executor: "single",
      }),
    ],
  ];
}

async function expectAll404(c: Client, skip: string[] = []) {
  for (const [label, p] of attempts(c)) {
    const res = await p;
    if (skip.includes(label)) continue;
    expect({ label, status: res.status, code: res.body?.error?.code }).toEqual({
      label,
      status: 404,
      code: "not_found",
    });
  }
}

async function expectAUntouched() {
  const owner = ctx.server.as(human(a.owner));
  const g = await owner.get(`/api/v1/goals/${goalId}`);
  expect(g.status).toBe(200);
  expect(g.body.goal.status).toBe("approved");
  expect(g.body.tasks).toHaveLength(2);
  const free = await getTask(owner, taskIds[0]!);
  expect(free.status).toBe("pending");
  const held = await getTask(owner, taskIds[1]!);
  expect(held.status).toBe("in_progress");
  expect(held.holder.device_id).toBe(holder.deviceId);
  const kinds = (await events(ctx.db, taskIds[1]!)).map((e) => e.kind).filter((k) => k !== "created");
  expect(kinds).toEqual(["claimed"]);
  expect((await events(ctx.db, taskIds[0]!)).filter((e) => e.kind !== "created")).toEqual([]);
}

describe("workspace B and workspace A's board", () => {
  it("B's owner, as a person, gets 404 not_found from every goal and task route on A's ids", async () => {
    await boardOfA();
    await expectAll404(ctx.server.as(human(b.owner)));
    await expectAUntouched();
  });

  it("an agent acting for B's owner gets 404 not_found from every goal and task route on A's ids", async () => {
    await boardOfA();
    // approve, cancel and release are humans only, which the check order answers first.
    await expectAll404(ctx.server.as(agent(b.owner)), ["approve", "cancel", "release goal", "release text"]);
    await expectAUntouched();
  });

  it("a run token of B's editor (for B's project) gets 404 not_found on A's goals and tasks", async () => {
    await boardOfA();
    const wk = await worker(ctx, b.editor, b.projectId);
    const c = wk.client;
    const tries: [string, Promise<any>][] = [
      ["get goal", c.get(`/api/v1/goals/${goalId}`)],
      ["get task", c.get(`/api/v1/tasks/${taskIds[0]}`)],
      ["claim", c.post(`/api/v1/tasks/${taskIds[0]}/claim`, {})],
      ["renew", c.post(`/api/v1/tasks/${taskIds[1]}/renew`, { claim_seq: seq })],
      ["done", c.post(`/api/v1/tasks/${taskIds[1]}/done`, { claim_seq: seq, proof: proof() })],
      ["fail", c.post(`/api/v1/tasks/${taskIds[1]}/fail`, { claim_seq: seq, reason: "x" })],
      ["release", c.post(`/api/v1/tasks/${taskIds[1]}/release`, { claim_seq: seq })],
      ["add tasks", c.post(`/api/v1/goals/${goalId}/tasks`, { tasks: [taskBody()] })],
    ];
    for (const [label, p] of tries) {
      const res = await p;
      expect({ label, status: res.status, code: res.body?.error?.code }).toEqual({
        label,
        status: 404,
        code: "not_found",
      });
    }
    const ready = await readyIds(c);
    expect(ready).not.toContain(taskIds[0]);
    await expectAUntouched();
  });

  it("B's device cannot mint a run token for A's project (404)", async () => {
    await boardOfA();
    const d = await loginDevice(ctx, b.owner);
    const res = await mint(ctx, d.deviceToken, { project_id: a.projectId, verbs: ["read"] });
    expect({ status: res.status, code: res.body?.error?.code }).toEqual({
      status: 404,
      code: "not_found",
    });
  });
});
