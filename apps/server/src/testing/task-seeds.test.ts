import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db/client.ts";
import { goals, taskDeps, tasks } from "../db/schema.ts";
import { taskTextHash } from "../tasks/task-text.ts";
import {
  closeTestDb,
  createTestDb,
  seedProject,
  seedWorkspace,
} from "./harness.ts";
import { seedGoal, seedTask } from "./task-seeds.ts";

let db: Db;
let workspaceId: string;
let projectId: string;

beforeAll(async () => {
  db = await createTestDb();
  workspaceId = (await seedWorkspace(db, { name: "seeds" })).id;
  projectId = (
    await seedProject(db, { workspaceId, slug: "seeds", name: "seeds" })
  ).id;
}, 60_000);

afterAll(async () => {
  if (db) await closeTestDb(db);
}, 60_000);

async function taskRow(id: string) {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  return row!;
}

describe("seedGoal", () => {
  it("writes a human draft by default", async () => {
    const g = await seedGoal(db, { workspaceId, projectId });
    const [row] = await db.select().from(goals).where(eq(goals.id, g.id));
    expect(row).toMatchObject({
      workspaceId,
      projectId,
      status: "draft",
      executor: "single",
      authorKind: "human",
      author: "seed-user",
      onBehalfOf: "seed-user",
      approvedBy: null,
      approvedAt: null,
      assignee: null,
      quarantinedBecause: null,
    });
  });

  it("writes an approved agent goal with its approver and quarantine", async () => {
    const g = await seedGoal(db, {
      workspaceId,
      projectId,
      title: "Ship",
      body: "Body",
      executor: "team",
      status: "approved",
      approvedBy: "u1",
      assignee: "u2",
      authorKind: "agent",
      author: "claude-code/planner",
      onBehalfOf: "u1",
      quarantinedBecause: "ignore-instructions",
    });
    const [row] = await db.select().from(goals).where(eq(goals.id, g.id));
    expect(row).toMatchObject({
      title: "Ship",
      body: "Body",
      executor: "team",
      status: "approved",
      approvedBy: "u1",
      assignee: "u2",
      authorKind: "agent",
      author: "claude-code/planner",
      onBehalfOf: "u1",
      quarantinedBecause: "ignore-instructions",
    });
    expect(row!.approvedAt).toBeInstanceOf(Date);
  });
});

describe("seedTask", () => {
  it("pins a task under an approved goal by default", async () => {
    const g = await seedGoal(db, {
      workspaceId,
      projectId,
      status: "approved",
      approvedBy: "u1",
    });
    const t = await seedTask(db, {
      goalId: g.id,
      title: "One",
      body: "Do it",
      files: ["src/a.ts"],
    });
    const row = await taskRow(t.id);
    const hash = taskTextHash({
      title: "One",
      body: "Do it",
      files: ["src/a.ts"],
      context_refs: [],
    });
    expect(row).toMatchObject({
      workspaceId,
      projectId,
      goalId: g.id,
      files: ["src/a.ts"],
      textHash: hash,
      approvedHash: hash,
    });
  });

  it("leaves a task under a draft goal unpinned, and honours pinned", async () => {
    const draft = await seedGoal(db, { workspaceId, projectId });
    const loose = await taskRow((await seedTask(db, { goalId: draft.id })).id);
    expect(loose.textHash).toMatch(/^[0-9a-f]{64}$/);
    expect(loose.approvedHash).toBeNull();
    expect(loose.files).toBeNull();

    const pinned = await taskRow(
      (await seedTask(db, { goalId: draft.id, pinned: true })).id,
    );
    expect(pinned.approvedHash).toBe(pinned.textHash);

    const approved = await seedGoal(db, {
      workspaceId,
      projectId,
      status: "approved",
      approvedBy: "u1",
    });
    const unpinned = await taskRow(
      (await seedTask(db, { goalId: approved.id, pinned: false })).id,
    );
    expect(unpinned.approvedHash).toBeNull();
  });

  it("numbers positions in order and writes the dependencies", async () => {
    const g = await seedGoal(db, { workspaceId, projectId });
    const a = await seedTask(db, { goalId: g.id });
    const b = await seedTask(db, { goalId: g.id });
    const c = await seedTask(db, {
      goalId: g.id,
      dependsOn: [a.id, b.id],
      status: "blocked",
      maxAttempts: 5,
      lane: "api",
      quarantinedBecause: "ignore-instructions",
    });
    const rows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.goalId, g.id))
      .orderBy(asc(tasks.position));
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id, c.id]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(rows[2]).toMatchObject({
      status: "blocked",
      maxAttempts: 5,
      lane: "api",
      quarantinedBecause: "ignore-instructions",
    });
    const deps = await db
      .select({ dependsOnId: taskDeps.dependsOnId })
      .from(taskDeps)
      .where(eq(taskDeps.taskId, c.id));
    expect(deps.map((d) => d.dependsOnId).sort()).toEqual([a.id, b.id].sort());
  });

  it("refuses an unknown goal", async () => {
    await expect(
      seedTask(db, { goalId: "00000000-0000-4000-8000-0000000000ff" }),
    ).rejects.toThrow(/seedTask: no goal/);
  });
});
