import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeTestDb,
  createTestDb,
  seedFeature,
  seedProject,
  seedWorkspace,
} from "../testing/harness.ts";
import { seedGoal, seedTask } from "../testing/task-seeds.ts";
import { taskTextHash } from "../tasks/task-text.ts";
import type { Db } from "./client.ts";
import { goals, taskDeps, taskEvents, tasks } from "./schema.ts";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  if (db) await closeTestDb(db);
}, 60_000);

async function world(name: string) {
  const ws = await seedWorkspace(db, { name });
  const project = await seedProject(db, {
    workspaceId: ws.id,
    slug: name,
    name,
  });
  const feature = await seedFeature(db, {
    projectId: project.id,
    slug: name,
    name,
  });
  return { workspaceId: ws.id, projectId: project.id, featureId: feature.id };
}

/** A raw task row, so a test can put any workspace and project on it. */
function rawTask(v: {
  goalId: string;
  workspaceId: string;
  projectId: string;
}) {
  const text = { title: "t", body: "b", files: null, context_refs: [] };
  return db.insert(tasks).values({
    ...v,
    title: text.title,
    body: text.body,
    textHash: taskTextHash(text),
    position: 0,
    authorKind: "human",
    author: "u1",
    onBehalfOf: "u1",
  });
}

describe("goals and tasks", () => {
  it("stores a goal and a task with the defaults", async () => {
    const w = await world("defaults");
    const g = await seedGoal(db, {
      workspaceId: w.workspaceId,
      projectId: w.projectId,
    });
    const t = await seedTask(db, { goalId: g.id });
    const [goal] = await db.select().from(goals).where(eq(goals.id, g.id));
    expect(goal).toMatchObject({
      status: "draft",
      executor: "single",
      featureId: null,
    });
    const [task] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(task).toMatchObject({
      workspaceId: w.workspaceId,
      projectId: w.projectId,
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      claimSeq: 0,
      contextRefs: [],
      holderDevice: null,
      proof: null,
    });
  });

  it("refuses a task with a project of another workspace", async () => {
    const a = await world("fk-a");
    const b = await world("fk-b");
    const goalB = await seedGoal(db, b);
    await expect(
      rawTask({
        goalId: goalB.id,
        workspaceId: a.workspaceId,
        projectId: b.projectId,
      }),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringMatching(/tasks_project_in_workspace_fk/),
      },
    });
  });

  it("refuses a task whose project is not its goal's", async () => {
    const w = await world("fk-goal");
    const other = await seedProject(db, {
      workspaceId: w.workspaceId,
      slug: "fk-goal-2",
      name: "fk-goal-2",
    });
    const g = await seedGoal(db, w);
    await expect(
      rawTask({
        goalId: g.id,
        workspaceId: w.workspaceId,
        projectId: other.id,
      }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/tasks_goal_in_project_fk/) },
    });
  });

  it("refuses a goal with a project of another workspace, or a feature of another project", async () => {
    const a = await world("goal-a");
    const b = await world("goal-b");
    await expect(
      seedGoal(db, { workspaceId: a.workspaceId, projectId: b.projectId }),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringMatching(/goals_project_in_workspace_fk/),
      },
    });
    await expect(
      seedGoal(db, { ...a, featureId: b.featureId }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/goals_feature_in_project_fk/) },
    });
  });

  it("refuses max_attempts outside 1..10", async () => {
    const w = await world("attempts");
    const g = await seedGoal(db, w);
    for (const maxAttempts of [0, 11]) {
      await expect(
        seedTask(db, { goalId: g.id, maxAttempts }),
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/tasks_max_attempts_range/) },
      });
    }
    await seedTask(db, { goalId: g.id, maxAttempts: 10 });
    await seedTask(db, { goalId: g.id, maxAttempts: 1 });
  });
});

describe("task_deps", () => {
  it("refuses a self-dependency", async () => {
    const w = await world("self");
    const g = await seedGoal(db, w);
    const t = await seedTask(db, { goalId: g.id });
    await expect(
      db.insert(taskDeps).values({ taskId: t.id, dependsOnId: t.id }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/task_deps_not_self/) },
    });
  });

  it("refuses the same dependency twice and goes with its task", async () => {
    const w = await world("deps");
    const g = await seedGoal(db, w);
    const a = await seedTask(db, { goalId: g.id });
    const b = await seedTask(db, { goalId: g.id, dependsOn: [a.id] });
    await expect(
      db.insert(taskDeps).values({ taskId: b.id, dependsOnId: a.id }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/task_deps_pkey|duplicate/) },
    });
    await db.delete(tasks).where(eq(tasks.id, a.id));
    expect(
      await db.select().from(taskDeps).where(eq(taskDeps.taskId, b.id)),
    ).toEqual([]);
  });
});

describe("task_events", () => {
  let workspaceId: string;
  let goalId: string;
  let taskId: string;

  beforeAll(async () => {
    const w = await world("events");
    workspaceId = w.workspaceId;
    goalId = (await seedGoal(db, w)).id;
    taskId = (await seedTask(db, { goalId })).id;
    await db.insert(taskEvents).values([
      {
        workspaceId,
        taskId,
        kind: "created",
        actor: "human:u1",
        onBehalfOf: "u1",
        claimSeq: 0,
      },
      {
        workspaceId,
        taskId,
        kind: "reclaimed",
        actor: "agent:pathly",
        onBehalfOf: "u1",
        deviceId: "00000000-0000-4000-8000-000000000009",
        claimSeq: 2,
        details: { from_actor: "agent:old", from_claim_seq: 1 },
      },
    ]);
  });

  async function rows() {
    return db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.workspaceId, workspaceId));
  }

  it("appends rows with a rising seq and the defaults", async () => {
    const all = (await rows()).sort((x, y) => x.seq - y.seq);
    expect(all).toHaveLength(2);
    expect(all[1]!.seq).toBeGreaterThan(all[0]!.seq);
    expect(all[0]).toMatchObject({ details: {}, deviceId: null });
    expect(all[0]!.at).toBeInstanceOf(Date);
    expect(all[1]).toMatchObject({
      kind: "reclaimed",
      claimSeq: 2,
      details: { from_actor: "agent:old", from_claim_seq: 1 },
    });
  });

  it("refuses an update", async () => {
    const before = await rows();
    await expect(
      db
        .update(taskEvents)
        .set({ kind: "done" })
        .where(eq(taskEvents.workspaceId, workspaceId)),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only: UPDATE/) },
    });
    expect(await rows()).toEqual(before);
  });

  it("refuses a delete", async () => {
    const before = await rows();
    await expect(
      db.delete(taskEvents).where(eq(taskEvents.workspaceId, workspaceId)),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only: DELETE/) },
    });
    expect(await rows()).toEqual(before);
  });

  it("refuses a truncate", async () => {
    const before = await rows();
    await expect(
      db.execute(sql`truncate table task_events`),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only: TRUNCATE/) },
    });
    expect(await rows()).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });

  it("keeps the events when the goal and its tasks are deleted", async () => {
    const before = await rows();
    await db.delete(goals).where(eq(goals.id, goalId));
    expect(await db.select().from(tasks).where(eq(tasks.id, taskId))).toEqual(
      [],
    );
    expect(await rows()).toEqual(before);
  });
});
