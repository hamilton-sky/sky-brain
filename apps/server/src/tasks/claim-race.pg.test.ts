// The claim race and the file-overlap lock on a real Postgres (ticket 08). PGlite runs one
// transaction at a time, so `pnpm test` cannot interleave claims; this file runs only with
// `pnpm test:pg` against TEST_DATABASE_URL. Each case seeds its own workspace, so the file can
// run again on the same database.
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createPostgresDb, migrateDb, type Db } from "../db/client.ts";
import { tasks } from "../db/schema.ts";
import { expectError, world } from "../run-tokens/tests/fixture.ts";
import { startTestServer, type TestServer } from "../testing/harness.ts";
import { seedGoal, seedTask } from "../testing/task-seeds.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL is not set: claim-race.pg.test.ts needs a real Postgres " +
      "(for example postgres://postgres:postgres@localhost:5432/postgres).",
  );
}

let db: Db;
let server: TestServer;

beforeAll(async () => {
  db = createPostgresDb(url);
  await migrateDb(db);
  server = await startTestServer({ db });
});

afterAll(async () => {
  if (server) await server.close();
  if (db) await closeDb(db);
});

const agent = (person: string, id: string) =>
  server.as({ kind: "agent", agent_id: id, on_behalf_of: person });

/** A fresh workspace with an approved goal in its project A. */
async function approvedGoal() {
  const w = await world(db);
  const g = await seedGoal(db, {
    workspaceId: w.workspaceId,
    projectId: w.projectA,
    status: "approved",
    approvedBy: w.editor,
  });
  return { w, goalId: g.id };
}

async function statuses(ids: string[]) {
  const rows = await db
    .select({ status: tasks.status, claimSeq: tasks.claimSeq })
    .from(tasks)
    .where(inArray(tasks.id, ids));
  return rows;
}

describe("claims on a real Postgres", () => {
  it("twenty concurrent claims of one ready task from twenty agents: exactly one 200", async () => {
    const { w, goalId } = await approvedGoal();
    const t = await seedTask(db, { goalId });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        agent(w.editor, `racer-${i}`).post(`/api/v1/tasks/${t.id}/claim`, {}),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const lost = results.filter((r) => r.status !== 200);
    expect(lost).toHaveLength(19);
    for (const r of lost) expectError(r, 409, "already_claimed");
    expect(await statuses([t.id])).toEqual([
      { status: "in_progress", claimSeq: 1 },
    ]);
  });

  it("ten tasks whose files all overlap, claimed concurrently: exactly one in_progress", async () => {
    const { w, goalId } = await approvedGoal();
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      // Every pair overlaps: each list names the folder `src/shared`.
      const files = ["src/shared", `src/shared/f${i}.ts`];
      ids.push((await seedTask(db, { goalId, files })).id);
    }
    const results = await Promise.all(
      ids.map((id, i) =>
        agent(w.editor, `overlap-${i}`).post(`/api/v1/tasks/${id}/claim`, {}),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const lost = results.filter((r) => r.status !== 200);
    expect(lost).toHaveLength(9);
    for (const r of lost) expectError(r, 409, "files_busy");
    const rows = await statuses(ids);
    expect(rows.filter((r) => r.status === "in_progress")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(9);
  });

  it("ten tasks with disjoint files, claimed concurrently: all ten get 200", async () => {
    const { w, goalId } = await approvedGoal();
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      ids.push((await seedTask(db, { goalId, files: [`lane-${i}/a.ts`] })).id);
    }
    const results = await Promise.all(
      ids.map((id, i) =>
        agent(w.editor, `disjoint-${i}`).post(`/api/v1/tasks/${id}/claim`, {}),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    const rows = await statuses(ids);
    expect(rows.every((r) => r.status === "in_progress")).toBe(true);
  });
});
