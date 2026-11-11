// Ready and claim filtered by workspace membership and by a run token's project (bar 4), and the
// claim verb (cloud-task-board ticket 06).
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { taskEvents, tasks } from "../db/schema.ts";
import {
  device,
  expectError,
  human,
  useRunTokenFixture,
  world,
} from "../run-tokens/tests/fixture.ts";
import type { Verb } from "@sky-brain/shared/run-tokens";
import {
  mintRunToken,
  seedGoal,
  seedTask,
  withToken,
} from "../testing/task-seeds.ts";

const ctx = useRunTokenFixture();
type W = Awaited<ReturnType<typeof world>>;

async function runToken(
  person: string,
  projectId: string,
  verbs: Verb[] = ["read", "claim"],
) {
  const d = await device(ctx.server, person);
  const { runToken } = await mintRunToken(ctx.server, d.deviceToken, {
    project_id: projectId,
    verbs,
  });
  return withToken(ctx.server, runToken);
}

/** A ready task in `projectId`, approved by `person`. */
async function readyTask(w: W, projectId: string, person: string) {
  const g = await seedGoal(ctx.db, {
    workspaceId: w.workspaceId,
    projectId,
    status: "approved",
    approvedBy: person,
  });
  return (await seedTask(ctx.db, { goalId: g.id })).id;
}

async function expectUntouched(id: string) {
  const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, id));
  expect(row).toMatchObject({
    status: "pending",
    claimSeq: 0,
    holderActor: null,
  });
  expect(
    await ctx.db.select().from(taskEvents).where(eq(taskEvents.taskId, id)),
  ).toEqual([]);
}

describe("workspace B (bar 4)", () => {
  it("B's owner, B's agent and a B run token get 404 on A's ready list and A's claim", async () => {
    const a = await world(ctx.db);
    const b = await world(ctx.db);
    const id = await readyTask(a, a.projectA, a.owner);
    const callers = [
      ctx.server.as(human(b.owner)),
      ctx.server.as({
        kind: "agent",
        agent_id: "claude-code",
        on_behalf_of: b.owner,
      }),
    ];
    for (const c of callers) {
      expectError(
        await c.get(`/api/v1/tasks/ready?project_id=${a.projectA}`),
        404,
        "not_found",
      );
      expectError(
        await c.post(`/api/v1/tasks/${id}/claim`, {}),
        404,
        "not_found",
      );
    }
    const bToken = await runToken(b.owner, b.projectA);
    expectError(
      await bToken.get(`/api/v1/tasks/ready?project_id=${a.projectA}`),
      404,
      "not_found",
    );
    expectError(
      await bToken.post(`/api/v1/tasks/${id}/claim`, {}),
      404,
      "not_found",
    );
    await expectUntouched(id);
    const ok = await ctx.server
      .as(human(a.owner))
      .get(`/api/v1/tasks/ready?project_id=${a.projectA}`);
    expect(ok.body.tasks.map((t: { id: string }) => t.id)).toEqual([id]);
  });
});

describe("a run token of another project (bar 4)", () => {
  it("gets 404 on that project's ready list and claim, also when the person is a member there", async () => {
    const w = await world(ctx.db);
    const inB = await readyTask(w, w.projectB, w.editor);
    const inA = await readyTask(w, w.projectA, w.editor);
    const c = await runToken(w.editor, w.projectA);
    expectError(
      await c.get(`/api/v1/tasks/ready?project_id=${w.projectB}`),
      404,
      "not_found",
    );
    expectError(
      await c.post(`/api/v1/tasks/${inB}/claim`, {}),
      404,
      "not_found",
    );
    await expectUntouched(inB);
    // Its own project, with or without project_id.
    const own = await c.get("/api/v1/tasks/ready");
    expect(own.body.tasks.map((t: { id: string }) => t.id)).toEqual([inA]);
    const named = await c.get(`/api/v1/tasks/ready?project_id=${w.projectA}`);
    expect(named.body.tasks.map((t: { id: string }) => t.id)).toEqual([inA]);
  });

  it("another workspace's project is 404 too", async () => {
    const w = await world(ctx.db);
    const g = await seedGoal(ctx.db, {
      workspaceId: w.workspaceId,
      projectId: w.projectA,
      status: "approved",
      approvedBy: w.editor,
    });
    const id = (await seedTask(ctx.db, { goalId: g.id })).id;
    // The editor is also an editor of the other workspace (project C).
    const c = await runToken(w.editor, w.projectC);
    expectError(
      await c.get(`/api/v1/tasks/ready?project_id=${w.projectA}`),
      404,
      "not_found",
    );
    expectError(
      await c.post(`/api/v1/tasks/${id}/claim`, {}),
      404,
      "not_found",
    );
    await expectUntouched(id);
  });
});

describe("verbs", () => {
  it("a token without claim gets 403 verb_not_allowed; one without read cannot list ready", async () => {
    const w = await world(ctx.db);
    const id = await readyTask(w, w.projectA, w.editor);
    const readOnly = await runToken(w.editor, w.projectA, ["read"]);
    expectError(
      await readOnly.post(`/api/v1/tasks/${id}/claim`, {}),
      403,
      "verb_not_allowed",
    );
    await expectUntouched(id);
    const claimOnly = await runToken(w.editor, w.projectA, ["claim"]);
    expectError(
      await claimOnly.get("/api/v1/tasks/ready"),
      403,
      "verb_not_allowed",
    );
    expect((await claimOnly.post(`/api/v1/tasks/${id}/claim`, {})).status).toBe(
      200,
    );
  });

  it("a person without a run token must name project_id (400)", async () => {
    const w = await world(ctx.db);
    expectError(
      await ctx.server.as(human(w.editor)).get("/api/v1/tasks/ready"),
      400,
      "invalid_request",
    );
  });
});
