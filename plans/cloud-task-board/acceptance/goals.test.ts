// Story: A person and their agents put work on the board. Bar item 6 (an agent cannot create an
// approved goal and cannot approve one).
import { describe, expect, it } from "vitest";
import {
  INSTRUCTION,
  addTasks,
  agent,
  approve,
  claim,
  createGoal,
  expectError,
  expectStatus,
  githubPat,
  human,
  readyIds,
  setup,
  taskBody,
  taskSeeds,
  world,
  worker,
  type World,
} from "./helpers.ts";

const ctx = setup();
const h = (w: World, who: keyof World = "editor") => ctx.server.as(human(w[who]));
const goalTasks = async (w: World, goalId: string) => {
  const res = await h(w, "owner").get(`/api/v1/goals/${goalId}`);
  expectStatus(res, 200);
  return res.body.tasks as any[];
};
const goalsOf = async (w: World) => {
  const res = await h(w, "owner").get(`/api/v1/goals?project_id=${w.projectId}`);
  expectStatus(res, 200);
  return res.body.goals as any[];
};

describe("create goals", () => {
  // "Any writer (owner or editor; a person, or an agent acting for one) can create a goal with
  // `POST /api/v1/goals`; it is always created `draft`. An agent's goal is a draft like anyone
  // else's, and an agent sending `assignee` gets 403 `agent_cannot_assign`."
  it("an owner, an editor, an agent and a run token each create a draft goal", async () => {
    const w = await world(ctx.db);
    const wk = await worker(ctx, w.editor, w.projectId, { verbs: ["plan", "read"] });
    const made = [
      await createGoal(h(w, "owner"), w.projectId),
      await createGoal(h(w, "editor"), w.projectId, { feature_id: w.featureId }),
      await createGoal(ctx.server.as(agent(w.owner)), w.projectId),
      await createGoal(wk.client, w.projectId),
    ];
    for (const g of made) {
      expect(g.status).toBe("draft");
      expect(g.approved_by).toBeNull();
      expect(g.workspace_id).toBe(w.workspaceId);
      expect(g.project_id).toBe(w.projectId);
    }
    expect(made[0].author_kind).toBe("human");
    expect(made[0].author).toBe(w.owner);
    expect(made[2].author_kind).toBe("agent");
    expect(made[2].on_behalf_of).toBe(w.owner);
    const listed = (await goalsOf(w)).map((g) => g.id).sort();
    expect(listed).toEqual(made.map((g) => g.id).sort());
  });

  // Bar 6: "an agent cannot create an approved goal (only a `draft`)"
  it("an agent cannot create an approved goal: a status in the body is refused 400 invalid_request", async () => {
    const w = await world(ctx.db);
    expectError(
      await ctx.server.as(agent(w.owner)).post("/api/v1/goals", {
        project_id: w.projectId,
        title: "Goal",
        body: "b",
        executor: "single",
        status: "approved",
      }),
      400,
      "invalid_request",
    );
    expect(await goalsOf(w)).toEqual([]);
  });

  it("an agent sending assignee gets 403 agent_cannot_assign; a person may assign", async () => {
    const w = await world(ctx.db);
    const wk = await worker(ctx, w.editor, w.projectId, { verbs: ["plan"] });
    const body = {
      project_id: w.projectId,
      title: "Goal",
      body: "b",
      executor: "single",
      assignee: w.editor,
    };
    expectError(
      await ctx.server.as(agent(w.owner)).post("/api/v1/goals", body),
      403,
      "agent_cannot_assign",
    );
    expectError(await wk.client.post("/api/v1/goals", body), 403, "agent_cannot_assign");
    expect(await goalsOf(w)).toEqual([]);
    const g = await createGoal(h(w, "owner"), w.projectId, { assignee: w.editor });
    expect(g.assignee).toBe(w.editor);
    expect(g.status).toBe("draft");
  });

  it("a viewer cannot create a goal (403 role_cannot_write)", async () => {
    const w = await world(ctx.db);
    expectError(
      await h(w, "viewer").post("/api/v1/goals", {
        project_id: w.projectId,
        title: "Goal",
        body: "b",
        executor: "single",
      }),
      403,
      "role_cannot_write",
    );
  });
});

describe("add tasks", () => {
  // "Any writer can add tasks to a goal that is not cancelled with `POST
  // /api/v1/goals/:id/tasks`; dependencies name earlier tasks of the same request (by index) or
  // existing tasks of the same goal (by id)."
  it("a writer adds tasks whose dependencies name earlier tasks by index and existing tasks by id", async () => {
    const w = await world(ctx.db);
    const g = await createGoal(h(w), w.projectId);
    const first = await addTasks(h(w), g.id, [
      { title: "one" },
      { title: "two", depends_on: [0] },
    ]);
    expect(first.map((t) => t.title)).toEqual(["one", "two"]);
    expect(first[0].depends_on).toEqual([]);
    expect(first[1].depends_on).toEqual([first[0].id]);
    const agentMade = await addTasks(ctx.server.as(agent(w.editor)), g.id, [
      { title: "three", depends_on: [first[1].id] },
      { title: "four", depends_on: [0, first[0].id] },
    ]);
    expect(agentMade[0].depends_on).toEqual([first[1].id]);
    expect([...agentMade[1].depends_on].sort()).toEqual([agentMade[0].id, first[0].id].sort());
    for (const t of [...first, ...agentMade]) {
      expect(t.goal_id).toBe(g.id);
      expect(t.status).toBe("pending");
      expect(t.attempts).toBe(0);
      expect(t.max_attempts).toBe(3);
    }
    expect((await goalTasks(w, g.id)).map((t) => t.title)).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });

  it("adding tasks to a cancelled goal gets 409 invalid_state", async () => {
    const w = await world(ctx.db);
    const g = await createGoal(h(w), w.projectId);
    expectStatus(await h(w).post(`/api/v1/goals/${g.id}/cancel`), 200);
    expectError(
      await h(w).post(`/api/v1/goals/${g.id}/tasks`, { tasks: [taskBody()] }),
      409,
      "invalid_state",
    );
    expect(await goalTasks(w, g.id)).toEqual([]);
  });

  // Edge: "`depends_on` names a later index, another goal's task or an unknown id | 400
  // `invalid_request` with `field` `tasks.<i>.depends_on`; nothing stored"
  it.each([
    ["a later index", (_other: string) => [2]],
    ["another goal's task", (other: string) => [other]],
    ["an unknown id", (_other: string) => ["7f1c7a2e-1b7e-4c55-9d7e-2f0a3c1b5d99"]],
  ])("depends_on naming %s is 400 invalid_request with field tasks.<i>.depends_on; nothing stored", async (_label, deps) => {
    const w = await world(ctx.db);
    const other = await createGoal(h(w), w.projectId);
    const [otherTask] = await addTasks(h(w), other.id, [{}]);
    const g = await createGoal(h(w), w.projectId);
    const res = await h(w).post(`/api/v1/goals/${g.id}/tasks`, {
      tasks: [taskBody(), taskBody({ depends_on: deps(otherTask.id) }), taskBody()],
    });
    expectError(res, 400, "invalid_request");
    expect(res.body.error.field).toBe("tasks.1.depends_on");
    expect(await goalTasks(w, g.id)).toEqual([]);
  });
});

describe("approve, cancel, release", () => {
  // "Only a person who is a writer can approve (`POST /api/v1/goals/:id/approve`), cancel and
  // release; an agent gets 403 `humans_only` from each, whatever its person's role."
  // Bar 6: "... and cannot approve one"
  it("an agent gets 403 humans_only from approve, cancel and release, even acting for the owner", async () => {
    const w = await world(ctx.db);
    const g = await createGoal(h(w), w.projectId);
    await addTasks(h(w), g.id, [{}]);
    const held = await createGoal(h(w), w.projectId, { body: INSTRUCTION });
    const a = ctx.server.as(agent(w.owner));
    expectError(await a.post(`/api/v1/goals/${g.id}/approve`), 403, "humans_only");
    expectError(await a.post(`/api/v1/goals/${g.id}/cancel`), 403, "humans_only");
    expectError(await a.post(`/api/v1/goals/${held.id}/release`), 403, "humans_only");
    const after = await h(w, "owner").get(`/api/v1/goals/${g.id}`);
    expect(after.body.goal.status).toBe("draft");
    expect(after.body.goal.approved_by).toBeNull();
    const heldAfter = await h(w, "owner").get(`/api/v1/goals/${held.id}`);
    expect(heldAfter.body.goal.quarantined_because).not.toBeNull();
  });

  it("a run token cannot approve a goal", async () => {
    const w = await world(ctx.db);
    const g = await createGoal(h(w), w.projectId);
    const wk = await worker(ctx, w.owner, w.projectId);
    const res = await wk.client.post(`/api/v1/goals/${g.id}/approve`);
    expect(res.status).toBe(403);
    expect(["humans_only", "verb_not_allowed"]).toContain(res.body?.error?.code);
    const after = await h(w, "owner").get(`/api/v1/goals/${g.id}`);
    expect(after.body.goal.status).toBe("draft");
  });

  it("a human writer approves (approved_by set) and cancels; a viewer gets 403 role_cannot_write", async () => {
    const w = await world(ctx.db);
    const g = await createGoal(h(w), w.projectId);
    await addTasks(h(w), g.id, [{}, {}]);
    expectError(await h(w, "viewer").post(`/api/v1/goals/${g.id}/approve`), 403, "role_cannot_write");
    const res = await approve(h(w), g.id);
    expect(res.goal.status).toBe("approved");
    expect(res.goal.approved_by).toBe(w.editor);
    expect(res.goal.approved_at).not.toBeNull();
    expect(res.pinned).toBe(2);
    expectError(await h(w, "viewer").post(`/api/v1/goals/${g.id}/cancel`), 403, "role_cannot_write");
    const cancelled = await h(w, "owner").post(`/api/v1/goals/${g.id}/cancel`);
    expectStatus(cancelled, 200);
    expect(cancelled.body.goal.status).toBe("cancelled");
  });
});

describe("pinned text", () => {
  // "Approving pins the text of every task in the goal; a task added or whose text changed
  // after approval is not ready and cannot be claimed until the goal is approved again."
  it("approving pins every task; a task added after approval is not ready until the goal is approved again", async () => {
    const w = await world(ctx.db);
    const g = await createGoal(h(w), w.projectId);
    const [t1] = await addTasks(h(w), g.id, [{}]);
    await approve(h(w), g.id);
    const [late] = await addTasks(h(w), g.id, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const tasks = await goalTasks(w, g.id);
    expect(tasks.find((t) => t.id === t1.id).pinned).toBe(true);
    expect(tasks.find((t) => t.id === late.id).pinned).toBe(false);
    const ready = await readyIds(wk.client);
    expect(ready).toContain(t1.id);
    expect(ready).not.toContain(late.id);
    expectError(await claim(wk, late.id), 409, "not_ready");
    const again = await approve(h(w), g.id);
    expect(again.pinned).toBeGreaterThanOrEqual(1);
    expect(await readyIds(wk.client)).toContain(late.id);
    expectStatus(await claim(wk, late.id), 200);
  });

  it("a task whose text changed after approval is not ready and cannot be claimed until approved again", async () => {
    const w = await world(ctx.db);
    const g = await createGoal(h(w), w.projectId);
    const [t1] = await addTasks(h(w), g.id, [{ title: "original" }]);
    await approve(h(w), g.id);
    await ctx.db.execute(`update tasks set title = 'changed after approval' where id = '${t1.id}'`);
    const wk = await worker(ctx, w.editor, w.projectId);
    const got = await wk.client.get(`/api/v1/tasks/${t1.id}`);
    expect(got.body.task.pinned).toBe(false);
    expect(await readyIds(wk.client)).not.toContain(t1.id);
    expectError(await claim(wk, t1.id), 409, "not_ready");
    await approve(h(w), g.id);
    expectStatus(await claim(wk, t1.id), 200);
  });

  // "Nothing under a `draft` or `cancelled` goal is ever ready or claimable."
  it("nothing under a draft or a cancelled goal is ready or claimable", async () => {
    const w = await world(ctx.db);
    const draft = await createGoal(h(w), w.projectId);
    const [d1] = await addTasks(h(w), draft.id, [{}]);
    const cancelled = await createGoal(h(w), w.projectId);
    const [c1] = await addTasks(h(w), cancelled.id, [{}]);
    await approve(h(w), cancelled.id);
    expectStatus(await h(w).post(`/api/v1/goals/${cancelled.id}/cancel`), 200);
    const wk = await worker(ctx, w.editor, w.projectId);
    const ready = await readyIds(wk.client);
    expect(ready).not.toContain(d1.id);
    expect(ready).not.toContain(c1.id);
    expectError(await claim(wk, d1.id), 409, "not_ready");
    expectError(await claim(wk, c1.id), 409, "not_ready");
  });
});

describe("secrets and quarantine", () => {
  // "A title, body, file or context ref holding a secret is refused with 422
  // `secret_detected` naming the rule, and nothing is stored."
  it("a goal title or body holding a secret is refused 422 secret_detected with the rule; nothing stored", async () => {
    const w = await world(ctx.db);
    for (const extra of [{ title: `token ${githubPat()}` }, { body: `use ${githubPat()}` }]) {
      const res = await h(w).post("/api/v1/goals", {
        project_id: w.projectId,
        title: "Goal",
        body: "b",
        executor: "single",
        ...extra,
      });
      expectError(res, 422, "secret_detected");
      expect(res.body.error.rule).toBe("github-pat");
      expect(res.text).not.toContain("ghp_");
    }
    expect(await goalsOf(w)).toEqual([]);
  });

  it.each([
    ["title", (s: string) => taskBody({ title: `t ${s}` })],
    ["body", (s: string) => taskBody({ body: `b ${s}` })],
    ["file", (s: string) => taskBody({ files: [`src/${s}.ts`] })],
    ["context ref", (s: string) => taskBody({ context_refs: [`https://x.test/?k=${s}`] })],
  ])("a task %s holding a secret is refused 422 secret_detected with the rule; nothing stored", async (_label, make) => {
    const w = await world(ctx.db);
    const g = await createGoal(h(w), w.projectId);
    const res = await h(w).post(`/api/v1/goals/${g.id}/tasks`, {
      tasks: [taskBody(), make(githubPat())],
    });
    expectError(res, 422, "secret_detected");
    expect(res.body.error.rule).toBe("github-pat");
    expect(await goalTasks(w, g.id)).toEqual([]);
  });

  // "Instruction-like title or body text is stored with `quarantined_because` set (201); a held
  // goal or task is never ready or claimable, an agent never sees it (404 on get, missing from
  // lists), and approve answers 409 `quarantined` until a person releases it."
  it("an instruction-like goal is stored with quarantined_because (201); approve is 409 quarantined until a person releases it", async () => {
    const w = await world(ctx.db);
    const res = await h(w).post("/api/v1/goals", {
      project_id: w.projectId,
      title: "Goal",
      body: INSTRUCTION,
      executor: "single",
    });
    expectStatus(res, 201);
    const g = res.body.goal;
    expect(g.quarantined_because).toBe("ignore-instructions");
    await addTasks(h(w), g.id, [{}]);
    expectError(await h(w).post(`/api/v1/goals/${g.id}/approve`), 409, "quarantined");
    const released = await h(w).post(`/api/v1/goals/${g.id}/release`);
    expectStatus(released, 200);
    expect(released.body.goal.quarantined_because).toBeNull();
    const ok = await approve(h(w), g.id);
    expect(ok.goal.status).toBe("approved");
  });

  it("an agent never sees a held goal or task: 404 on get, missing from lists", async () => {
    const w = await world(ctx.db);
    const heldGoal = await createGoal(h(w), w.projectId, { title: INSTRUCTION });
    expect(heldGoal.quarantined_because).toBe("ignore-instructions");
    const g = await createGoal(h(w), w.projectId);
    const [plain, heldTask] = await addTasks(h(w), g.id, [{}, { body: INSTRUCTION }]);
    expect(heldTask.quarantined_because).toBe("ignore-instructions");
    expect(plain.quarantined_because).toBeNull();
    const wk = await worker(ctx, w.editor, w.projectId);
    for (const c of [ctx.server.as(agent(w.editor)), wk.client]) {
      expectError(await c.get(`/api/v1/goals/${heldGoal.id}`), 404, "not_found");
      expectError(await c.get(`/api/v1/tasks/${heldTask.id}`), 404, "not_found");
      const list = await c.get(`/api/v1/goals?project_id=${w.projectId}`);
      expectStatus(list, 200);
      expect(list.body.goals.map((x: any) => x.id)).toEqual([g.id]);
      const got = await c.get(`/api/v1/goals/${g.id}`);
      expectStatus(got, 200);
      expect(got.body.tasks.map((x: any) => x.id)).toEqual([plain.id]);
    }
    const person = await h(w).get(`/api/v1/tasks/${heldTask.id}`);
    expectStatus(person, 200);
  });

  it("a held goal or task under an approved goal is never ready or claimable", async () => {
    const w = await world(ctx.db);
    const seeds = await taskSeeds();
    const heldGoal = await seeds.seedGoal(ctx.db, {
      workspaceId: w.workspaceId,
      projectId: w.projectId,
      status: "approved",
      approvedBy: w.editor,
      quarantinedBecause: "ignore-instructions",
    });
    const underHeldGoal = await seeds.seedTask(ctx.db, { goalId: heldGoal.id });
    const g = await seeds.seedGoal(ctx.db, {
      workspaceId: w.workspaceId,
      projectId: w.projectId,
      status: "approved",
      approvedBy: w.editor,
    });
    const heldTask = await seeds.seedTask(ctx.db, {
      goalId: g.id,
      quarantinedBecause: "ignore-instructions",
    });
    const plain = await seeds.seedTask(ctx.db, { goalId: g.id });
    const wk = await worker(ctx, w.editor, w.projectId);
    const ready = await readyIds(wk.client);
    expect(ready).toContain(plain.id);
    expect(ready).not.toContain(heldTask.id);
    expect(ready).not.toContain(underHeldGoal.id);
    const humanReady = await readyIds(h(w), `?project_id=${w.projectId}`);
    expect(humanReady).not.toContain(heldTask.id);
    expect(humanReady).not.toContain(underHeldGoal.id);
    for (const id of [heldTask.id, underHeldGoal.id]) {
      expectError(await claim(wk, id), 404, "not_found");
      expectError(await h(w).post(`/api/v1/tasks/${id}/claim`, {}), 409, "not_ready");
    }
    const released = await h(w).post(`/api/v1/tasks/${heldTask.id}/release-text`);
    expectStatus(released, 200);
    expect(released.body.task.quarantined_because).toBeNull();
  });
});
