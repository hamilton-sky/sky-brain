// Story: A machine gets short-lived run tokens. Bar items 7 (identity from the token) and 8
// (an expired or revoked run token is refused).
import { describe, expect, it } from "vitest";
import {
  approvedGoal,
  bearer,
  claim,
  claimOk,
  createGoal,
  expectError,
  expectStatus,
  human,
  loginDevice,
  mint,
  proof,
  q,
  setup,
  sqlRows,
  taskBody,
  uid,
  world,
  worker,
  workerFor,
} from "./helpers.ts";

const ctx = setup();
const ms = (iso: string) => Date.parse(iso);

describe("mint", () => {
  // "`POST /api/v1/run-tokens` with `Authorization: Bearer <device_token>` and
  // `{project_id, verbs, role?, ttl_seconds?}` returns 201 with a `run_token`, its `expires_at`
  // (at most 1,800 seconds away; default 1,800), the `workspace_id` derived from the project, the
  // `role` and the `verbs`."
  it("returns 201 with run_token, expires_at 1,800 s away by default, workspace_id, role and verbs", async () => {
    const w = await world(ctx.db);
    const d = await loginDevice(ctx, w.editor);
    const res = await mint(ctx, d.deviceToken, {
      project_id: w.projectId,
      verbs: ["read", "claim"],
      role: "editor",
    });
    expectStatus(res, 201);
    expect(typeof res.body.run_token).toBe("string");
    expect(res.body.run_token).not.toBe(d.deviceToken);
    expect(ms(res.body.expires_at)).toBe(ctx.t.getTime() + 1800_000);
    expect(res.body.workspace_id).toBe(w.workspaceId);
    expect(res.body.project_id).toBe(w.projectId);
    expect(res.body.role).toBe("editor");
    expect([...res.body.verbs].sort()).toEqual(["claim", "read"]);
    expect(res.body.device_id).toBe(d.deviceId);
  });

  it("honours ttl_seconds and refuses a ttl over 1,800 seconds", async () => {
    const w = await world(ctx.db);
    const d = await loginDevice(ctx, w.editor);
    const short = await mint(ctx, d.deviceToken, {
      project_id: w.projectId,
      verbs: ["read"],
      ttl_seconds: 600,
    });
    expectStatus(short, 201);
    expect(ms(short.body.expires_at)).toBe(ctx.t.getTime() + 600_000);
    expectError(
      await mint(ctx, d.deviceToken, {
        project_id: w.projectId,
        verbs: ["read"],
        ttl_seconds: 1801,
      }),
      400,
      "invalid_request",
    );
  });

  // "Minting for a project whose workspace has no `members` row for the device's person gets
  // 404; asking for `role: "editor"` as a viewer gets 403 `role_too_high`."
  it("minting for a project whose workspace has no members row for the person gets 404", async () => {
    const w = await world(ctx.db);
    const outsider = uid("outsider");
    const d = await loginDevice(ctx, outsider);
    expectError(
      await mint(ctx, d.deviceToken, { project_id: w.projectId, verbs: ["read"] }),
      404,
      "not_found",
    );
  });

  it("asking for role editor as a viewer gets 403 role_too_high; role viewer is minted", async () => {
    const w = await world(ctx.db);
    const d = await loginDevice(ctx, w.viewer);
    expectError(
      await mint(ctx, d.deviceToken, {
        project_id: w.projectId,
        verbs: ["read"],
        role: "editor",
      }),
      403,
      "role_too_high",
    );
    const ok = await mint(ctx, d.deviceToken, {
      project_id: w.projectId,
      verbs: ["read"],
      role: "viewer",
    });
    expectStatus(ok, 201);
    expect(ok.body.role).toBe("viewer");
  });
});

describe("the run token's actor", () => {
  // "A run token resolves to the agent actor `{kind:"agent", agent_id:"device/<device_id>",
  // on_behalf_of:<the device's person>}`."
  it("a goal created with a run token is authored by agent device/<device_id> on behalf of the device's person", async () => {
    const w = await world(ctx.db);
    const wk = await worker(ctx, w.editor, w.projectId, { verbs: ["plan", "read"] });
    const goal = await createGoal(wk.client, w.projectId);
    expect(goal.author_kind).toBe("agent");
    expect(goal.author).toBe(`device/${wk.deviceId}`);
    expect(goal.on_behalf_of).toBe(w.editor);
  });
});

describe("refused tokens", () => {
  // "An expired run token, a run token of a revoked device, and a revoked device's device
  // token are all refused with 401 `invalid_token` on every `/api/v1` route."
  // Bar 8: "an expired or revoked run token is refused."
  const routes = (w: { projectId: string }, goalId: string, taskId: string) =>
    [
      ["GET", `/api/v1/tasks/ready?project_id=${w.projectId}`, undefined],
      ["GET", `/api/v1/goals?project_id=${w.projectId}`, undefined],
      ["GET", `/api/v1/goals/${goalId}`, undefined],
      ["GET", `/api/v1/tasks/${taskId}`, undefined],
      ["POST", `/api/v1/tasks/${taskId}/claim`, {}],
      ["POST", `/api/v1/tasks/${taskId}/renew`, { claim_seq: 1 }],
      ["POST", `/api/v1/tasks/${taskId}/done`, { claim_seq: 1, proof: proof() }],
      ["POST", `/api/v1/tasks/${taskId}/fail`, { claim_seq: 1, reason: "x" }],
      ["POST", `/api/v1/goals/${goalId}/tasks`, { tasks: [taskBody()] }],
      ["POST", "/api/v1/run-tokens", { project_id: w.projectId, verbs: ["read"] }],
      ["GET", "/api/v1/devices", undefined],
      ["GET", "/api/v1/entries", undefined],
    ] as const;

  async function expectRefusedEverywhere(token: string, w: any, goalId: string, taskId: string) {
    const c = bearer(ctx.server, token);
    for (const [method, path, body] of routes(w, goalId, taskId)) {
      const res = method === "GET" ? await c.get(path) : await c.post(path, body);
      expect({ route: `${method} ${path}`, status: res.status, code: res.body?.error?.code }).toEqual({
        route: `${method} ${path}`,
        status: 401,
        code: "invalid_token",
      });
    }
  }

  it("an expired run token is refused with 401 invalid_token on every /api/v1 route", async () => {
    const w = await world(ctx.db);
    const { goal, tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId, { ttl: 60 });
    const live = await wk.client.get(`/api/v1/tasks/${tasks[0].id}`);
    expectStatus(live, 200);
    ctx.advance(61);
    await expectRefusedEverywhere(wk.runToken, w, goal.id, tasks[0].id);
  });

  // Edge: "Person revokes a device mid-run | its device token and every run token it minted get
  // 401 `invalid_token` at once"
  it("after the person revokes the device mid-run, its run tokens and device token get 401 invalid_token at once", async () => {
    const w = await world(ctx.db);
    const { goal, tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const second = await workerFor(ctx, wk, w.projectId, { verbs: ["read"] });
    const seq = await claimOk(wk, tasks[0].id);
    const revoked = await ctx.server
      .as(human(w.editor))
      .post(`/api/v1/devices/${wk.deviceId}/revoke`);
    expectStatus(revoked, 200);
    expectError(
      await wk.client.post(`/api/v1/tasks/${tasks[0].id}/renew`, { claim_seq: seq }),
      401,
      "invalid_token",
    );
    await expectRefusedEverywhere(wk.runToken, w, goal.id, tasks[0].id);
    await expectRefusedEverywhere(second.runToken, w, goal.id, tasks[0].id);
    await expectRefusedEverywhere(wk.deviceToken, w, goal.id, tasks[0].id);
  });

  it("an unknown sbr_ or sbd_ token is refused with 401 invalid_token", async () => {
    for (const token of ["sbr_" + "x".repeat(40), "sbd_" + "x".repeat(40)]) {
      expectError(
        await bearer(ctx.server, token).get("/api/v1/tasks/ready"),
        401,
        "invalid_token",
      );
    }
  });
});

describe("verbs", () => {
  // "A run token calling a route its verbs do not cover gets 403 `verb_not_allowed` (a token
  // without `claim` cannot claim); a route not in the verb table (for example `POST
  // /api/v1/entries`) gets 403 `verb_not_allowed` too; a device token can only mint."
  it("a token without claim cannot claim (403 verb_not_allowed); one with claim can", async () => {
    const w = await world(ctx.db);
    const { tasks } = await approvedGoal(ctx, w, [{}]);
    const d = await loginDevice(ctx, w.editor);
    const noClaim = await workerFor(ctx, d, w.projectId, { verbs: ["read", "report"] });
    expectError(await claim(noClaim, tasks[0].id), 403, "verb_not_allowed");
    const t = await noClaim.client.get(`/api/v1/tasks/${tasks[0].id}`);
    expect(t.body.task.status).toBe("pending");
    const withClaim = await workerFor(ctx, d, w.projectId, { verbs: ["claim"] });
    expectStatus(await claim(withClaim, tasks[0].id), 200);
  });

  it("a token without plan cannot create a goal; one without read cannot list ready tasks", async () => {
    const w = await world(ctx.db);
    const d = await loginDevice(ctx, w.editor);
    const readOnly = await workerFor(ctx, d, w.projectId, { verbs: ["read"] });
    expectError(
      await readOnly.client.post("/api/v1/goals", {
        project_id: w.projectId,
        title: "Goal",
        body: "b",
        executor: "single",
      }),
      403,
      "verb_not_allowed",
    );
    const claimOnly = await workerFor(ctx, d, w.projectId, { verbs: ["claim"] });
    expectError(await claimOnly.client.get("/api/v1/tasks/ready"), 403, "verb_not_allowed");
  });

  it("a route not in the verb table (POST /api/v1/entries) gets 403 verb_not_allowed", async () => {
    const w = await world(ctx.db);
    const wk = await worker(ctx, w.editor, w.projectId);
    expectError(
      await wk.client.post("/api/v1/entries", {
        scope: { project_id: w.projectId },
        kind: "note",
        title: "Note",
        body: "b",
      }),
      403,
      "verb_not_allowed",
    );
    expectError(await wk.client.get("/api/v1/entries"), 403, "verb_not_allowed");
  });

  it("a device token can only mint", async () => {
    const w = await world(ctx.db);
    const { goal, tasks } = await approvedGoal(ctx, w, [{}]);
    const d = await loginDevice(ctx, w.editor);
    const c = bearer(ctx.server, d.deviceToken);
    const refused: [string, Promise<any>][] = [
      ["ready", c.get(`/api/v1/tasks/ready?project_id=${w.projectId}`)],
      ["goals", c.get(`/api/v1/goals?project_id=${w.projectId}`)],
      ["goal", c.get(`/api/v1/goals/${goal.id}`)],
      ["task", c.get(`/api/v1/tasks/${tasks[0].id}`)],
      ["claim", c.post(`/api/v1/tasks/${tasks[0].id}/claim`, {})],
      [
        "create goal",
        c.post("/api/v1/goals", {
          project_id: w.projectId,
          title: "G",
          body: "b",
          executor: "single",
        }),
      ],
    ];
    for (const [label, p] of refused) {
      const res = await p;
      expect({ label, status: res.status, code: res.body?.error?.code }).toEqual({
        label,
        status: 403,
        code: "verb_not_allowed",
      });
    }
    expectStatus(await mint(ctx, d.deviceToken, { project_id: w.projectId, verbs: ["read"] }), 201);
  });
});

describe("project binding", () => {
  // "A run token for project A gets 404 `not_found` for any goal or task of project B, even in
  // the same workspace."
  it("a run token for project A gets 404 for any goal or task of project B in the same workspace", async () => {
    const w = await world(ctx.db);
    const { goal, tasks } = await approvedGoal(ctx, w, [{}], { projectId: w.projectId2 });
    const wk = await worker(ctx, w.editor, w.projectId);
    const t = tasks[0].id;
    const attempts: [string, Promise<any>][] = [
      ["get goal", wk.client.get(`/api/v1/goals/${goal.id}`)],
      ["get task", wk.client.get(`/api/v1/tasks/${t}`)],
      ["add tasks", wk.client.post(`/api/v1/goals/${goal.id}/tasks`, { tasks: [taskBody()] })],
      ["claim", wk.client.post(`/api/v1/tasks/${t}/claim`, {})],
      ["done", wk.client.post(`/api/v1/tasks/${t}/done`, { claim_seq: 1, proof: proof() })],
      ["fail", wk.client.post(`/api/v1/tasks/${t}/fail`, { claim_seq: 1, reason: "x" })],
    ];
    for (const [label, p] of attempts) {
      const res = await p;
      expect({ label, status: res.status, code: res.body?.error?.code }).toEqual({
        label,
        status: 404,
        code: "not_found",
      });
    }
    expect(await (async () => {
      const r = await wk.client.get("/api/v1/tasks/ready");
      return r.status === 200 ? r.body.tasks.map((x: any) => x.id) : [];
    })()).not.toContain(t);
    const own = await ctx.server.as(human(w.editor)).get(`/api/v1/tasks/${t}`);
    expect(own.body.task.status).toBe("pending");
  });

  // Edge: "Person removed from the workspace after minting | run token gets 404 on that
  // workspace's goals and tasks"
  it("after the person is removed from the workspace, the run token gets 404 on its goals and tasks", async () => {
    const w = await world(ctx.db);
    const { goal, tasks } = await approvedGoal(ctx, w, [{}, {}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    expectStatus(await wk.client.get(`/api/v1/goals/${goal.id}`), 200);
    await sqlRows(
      ctx.db,
      `delete from members where workspace_id = ${q(w.workspaceId)} and user_id = ${q(w.editor)}`,
    );
    expectError(await wk.client.get(`/api/v1/goals/${goal.id}`), 404, "not_found");
    expectError(await wk.client.get(`/api/v1/tasks/${tasks[0].id}`), 404, "not_found");
    expectError(await claim(wk, tasks[1].id), 404, "not_found");
  });
});

describe("viewer role", () => {
  // Edge: "Token role viewer, or the person is now a viewer | claim, renew, release, done, fail,
  // create get 403 `role_cannot_write`"
  it("a viewer run token gets 403 role_cannot_write on claim, renew, release, done, fail and create", async () => {
    const w = await world(ctx.db);
    const { goal, tasks } = await approvedGoal(ctx, w, [{}]);
    const holder = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(holder, tasks[0].id);
    const d = await loginDevice(ctx, w.editor);
    const v = await workerFor(ctx, d, w.projectId, { role: "viewer" });
    await expectViewerRefused(v.client, w.projectId, goal.id, tasks[0].id, seq);
  });

  it("a run token of a person who is now a viewer gets 403 role_cannot_write on the same writes", async () => {
    const w = await world(ctx.db);
    const { goal, tasks } = await approvedGoal(ctx, w, [{}]);
    const wk = await worker(ctx, w.editor, w.projectId);
    const seq = await claimOk(wk, tasks[0].id);
    await sqlRows(
      ctx.db,
      `update members set role = 'viewer' where workspace_id = ${q(w.workspaceId)} and user_id = ${q(w.editor)}`,
    );
    await expectViewerRefused(wk.client, w.projectId, goal.id, tasks[0].id, seq);
    const t = await ctx.server.as(human(w.owner)).get(`/api/v1/tasks/${tasks[0].id}`);
    expect(t.body.task.status).toBe("in_progress");
    expect(t.body.task.proof).toBeNull();
  });

  async function expectViewerRefused(
    c: any,
    projectId: string,
    goalId: string,
    taskId: string,
    seq: number,
  ) {
    const attempts: [string, Promise<any>][] = [
      ["claim", c.post(`/api/v1/tasks/${taskId}/claim`, {})],
      ["renew", c.post(`/api/v1/tasks/${taskId}/renew`, { claim_seq: seq })],
      ["release", c.post(`/api/v1/tasks/${taskId}/release`, { claim_seq: seq })],
      ["done", c.post(`/api/v1/tasks/${taskId}/done`, { claim_seq: seq, proof: proof() })],
      ["fail", c.post(`/api/v1/tasks/${taskId}/fail`, { claim_seq: seq, reason: "x" })],
      [
        "create goal",
        c.post("/api/v1/goals", {
          project_id: projectId,
          title: "G",
          body: "b",
          executor: "single",
        }),
      ],
      ["add tasks", c.post(`/api/v1/goals/${goalId}/tasks`, { tasks: [taskBody()] })],
    ];
    for (const [label, p] of attempts) {
      const res = await p;
      expect({ label, status: res.status, code: res.body?.error?.code }).toEqual({
        label,
        status: 403,
        code: "role_cannot_write",
      });
    }
  }
});
