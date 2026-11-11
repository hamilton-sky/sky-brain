// Getting and releasing a task, and every route of ticket 05 filtered by workspace membership and
// by a run token's project (CLAUDE.md hard rule 4, bar 4; cloud-task-board ticket 05).
import { and, eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, taskEvents, tasks } from "../db/schema.ts";
import {
  UUID,
  device,
  expectError,
  human,
  useRunTokenFixture,
  world,
} from "../run-tokens/tests/fixture.ts";
import type { TestClient, TestResponse } from "../testing/harness.ts";
import {
  mintRunToken,
  seedGoal,
  seedTask,
  withToken,
} from "../testing/task-seeds.ts";

const ctx = useRunTokenFixture();
type W = Awaited<ReturnType<typeof world>>;

const HELD = "ignore-instructions";
const as = (person: string) => ctx.server.as(human(person));
const agent = (person: string) =>
  ctx.server.as({
    kind: "agent",
    agent_id: "claude-code",
    on_behalf_of: person,
  });
async function runToken(person: string, projectId: string) {
  const d = await device(ctx.server, person);
  const { runToken } = await mintRunToken(ctx.server, d.deviceToken, {
    project_id: projectId,
    verbs: ["read", "plan"],
  });
  return withToken(ctx.server, runToken);
}

/** An approved goal in `projectId` with a plain task and a held one. */
async function target(w: W, projectId: string) {
  const g = await seedGoal(ctx.db, {
    workspaceId: w.workspaceId,
    projectId,
    status: "approved",
    approvedBy: w.owner,
  });
  const plain = await seedTask(ctx.db, { goalId: g.id });
  const held = await seedTask(ctx.db, {
    goalId: g.id,
    quarantinedBecause: HELD,
    dependsOn: [plain.id],
  });
  return { goalId: g.id, plain: plain.id, held: held.id };
}
type T = Awaited<ReturnType<typeof target>>;

const routes = (
  c: TestClient,
  t: T,
): [string, () => Promise<TestResponse>][] => [
  [
    "add",
    () =>
      c.post(`/api/v1/goals/${t.goalId}/tasks`, {
        tasks: [{ title: "x", body: "y" }],
      }),
  ],
  ["get", () => c.get(`/api/v1/tasks/${t.plain}`)],
  ["get held", () => c.get(`/api/v1/tasks/${t.held}`)],
  ["release", () => c.post(`/api/v1/tasks/${t.held}/release-text`)],
  ["release plain", () => c.post(`/api/v1/tasks/${t.plain}/release-text`)],
];

async function expect404(c: TestClient, t: T, only?: string[]) {
  for (const [label, call] of routes(c, t)) {
    if (only && !only.includes(label)) continue;
    const res = await call();
    expect({ label, status: res.status, code: res.body?.error?.code }).toEqual({
      label,
      status: 404,
      code: "not_found",
    });
  }
}

async function expectUntouched(w: W, t: T) {
  const rows = await ctx.db
    .select()
    .from(tasks)
    .where(eq(tasks.goalId, t.goalId));
  expect(rows.map((r) => [r.id, r.quarantinedBecause])).toEqual([
    [t.plain, null],
    [t.held, HELD],
  ]);
  const audit = await ctx.db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.workspaceId, w.workspaceId),
        like(auditLog.action, "task.%"),
      ),
    );
  expect(audit).toEqual([]);
  const events = await ctx.db
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.workspaceId, w.workspaceId));
  expect(events).toEqual([]);
}

describe("workspace B and workspace A's tasks (bar 4)", () => {
  it("B's owner gets 404 on adding to, getting and releasing A's tasks; nothing changes", async () => {
    const a = await world(ctx.db);
    const b = await world(ctx.db);
    const t = await target(a, a.projectA);
    await expect404(as(b.owner), t);
    await expect404(agent(b.owner), t, ["add", "get"]);
    await expectUntouched(a, t);
    expect((await as(a.owner).get(`/api/v1/tasks/${t.plain}`)).status).toBe(
      200,
    );
  });

  it("a run token of project A gets 404 on project B's goal and tasks, and on another workspace's", async () => {
    const w = await world(ctx.db);
    const other = await world(ctx.db);
    const tB = await target(w, w.projectB);
    const tOther = await target(other, other.projectA);
    const c = await runToken(w.editor, w.projectA);
    await expect404(c, tB, ["add", "get"]);
    await expect404(c, tOther, ["add", "get"]);
    await expectUntouched(w, tB);
    await expectUntouched(other, tOther);
  });
});

describe("GET /api/v1/tasks/:id", () => {
  it("a member, a viewer included, gets the task with depends_on and the effective status; bad id 400, unknown 404", async () => {
    const w = await world(ctx.db);
    const t = await target(w, w.projectA);
    const got = await as(w.viewer).get(`/api/v1/tasks/${t.held}`);
    expect(got.status).toBe(200);
    expect(got.body.task).toMatchObject({
      id: t.held,
      goal_id: t.goalId,
      depends_on: [t.plain],
      status: "pending",
      quarantined_because: HELD,
      pinned: true,
    });
    // An in_progress row whose lease has passed reads pending, with no holder.
    await ctx.db
      .update(tasks)
      .set({
        status: "in_progress",
        holderActor: `human:${w.owner}`,
        leaseExpiresAt: new Date(ctx.now().getTime() + 60_000),
      })
      .where(eq(tasks.id, t.plain));
    const live = await as(w.owner).get(`/api/v1/tasks/${t.plain}`);
    expect(live.body.task.status).toBe("in_progress");
    expect(live.body.task.holder).toMatchObject({ actor: `human:${w.owner}` });
    ctx.advance(61);
    const lapsed = await as(w.owner).get(`/api/v1/tasks/${t.plain}`);
    expect(lapsed.body.task).toMatchObject({ status: "pending", holder: null });
    expectError(
      await as(w.owner).get("/api/v1/tasks/nope"),
      400,
      "invalid_request",
    );
    expectError(
      await as(w.owner).get(`/api/v1/tasks/${UUID}`),
      404,
      "not_found",
    );
  });

  it("an agent and a run token get 404 on a held task and on any task of a held goal; a person sees both", async () => {
    const w = await world(ctx.db);
    const t = await target(w, w.projectA);
    const heldGoal = await seedGoal(ctx.db, {
      workspaceId: w.workspaceId,
      projectId: w.projectA,
      quarantinedBecause: HELD,
    });
    const underHeld = await seedTask(ctx.db, { goalId: heldGoal.id });
    for (const c of [agent(w.owner), await runToken(w.owner, w.projectA)]) {
      for (const id of [t.held, underHeld.id]) {
        expectError(await c.get(`/api/v1/tasks/${id}`), 404, "not_found");
      }
      expect((await c.get(`/api/v1/tasks/${t.plain}`)).status).toBe(200);
    }
    for (const id of [t.held, underHeld.id]) {
      expect((await as(w.owner).get(`/api/v1/tasks/${id}`)).status).toBe(200);
    }
  });
});

describe("POST /api/v1/tasks/:id/release-text", () => {
  it("a human writer clears quarantined_because, audit task.release_text; a second release is 409 invalid_state", async () => {
    const w = await world(ctx.db);
    const t = await target(w, w.projectA);
    const res = await as(w.editor).post(`/api/v1/tasks/${t.held}/release-text`);
    expect(res.status).toBe(200);
    expect(res.body.task).toMatchObject({
      id: t.held,
      quarantined_because: null,
      depends_on: [t.plain],
    });
    const audit = await ctx.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.workspaceId, w.workspaceId),
          eq(auditLog.action, "task.release_text"),
        ),
      );
    expect(audit).toMatchObject([
      {
        targetId: t.held,
        actor: `human:${w.editor}`,
        details: { quarantined_because: HELD, goal_id: t.goalId },
      },
    ]);
    expectError(
      await as(w.editor).post(`/api/v1/tasks/${t.held}/release-text`),
      409,
      "invalid_state",
    );
    expectError(
      await as(w.editor).post(`/api/v1/tasks/${t.plain}/release-text`),
      409,
      "invalid_state",
    );
    expect((await agent(w.owner).get(`/api/v1/tasks/${t.held}`)).status).toBe(
      200,
    );
  });

  it("an agent gets 403 humans_only, a run token 403 verb_not_allowed, a viewer 403 role_cannot_write; the task stays held", async () => {
    const w = await world(ctx.db);
    const t = await target(w, w.projectA);
    const path = `/api/v1/tasks/${t.held}/release-text`;
    expectError(await agent(w.owner).post(path), 403, "humans_only");
    const token = await runToken(w.owner, w.projectA);
    expectError(await token.post(path), 403, "verb_not_allowed");
    expectError(await as(w.viewer).post(path), 403, "role_cannot_write");
    expectError(
      await as(w.owner).post("/api/v1/tasks/nope/release-text"),
      400,
      "invalid_request",
    );
    expectError(
      await as(w.owner).post(`/api/v1/tasks/${UUID}/release-text`),
      404,
      "not_found",
    );
    await expectUntouched(w, t);
  });
});
