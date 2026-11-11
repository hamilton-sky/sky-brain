// Pathly's file-overlap rule (spec.md Decisions) and bar 5: two tasks with overlapping files
// never run at once (cloud-task-board ticket 06).
import { describe, expect, it } from "vitest";
import {
  expectError,
  human,
  useRunTokenFixture,
  world,
} from "../run-tokens/tests/fixture.ts";
import { seedGoal, seedTask } from "../testing/task-seeds.ts";
import { overlaps } from "./file-overlap.ts";

describe("overlaps(a, b)", () => {
  it.each([
    ["equal paths", ["src/a.ts"], ["src/a.ts"], true],
    ["a folder of the other", ["src"], ["src/a/b.ts"], true],
    ["the other way round", ["src/a/b.ts"], ["src/a"], true],
    ["a trailing slash", ["src/a/"], ["src/a/b.ts"], true],
    ["backslashes", ["src\\a"], ["src/a/b.ts"], true],
    ["backslashes both sides", ["src\\a\\b.ts"], ["src/a/b.ts"], true],
    ["a shared prefix that is not a folder", ["src/a"], ["src/ab.ts"], false],
    ["different paths", ["src/a.ts"], ["lib/a.ts"], false],
    ["one match among many", ["docs/x.md", "lib"], ["src", "lib/y.ts"], true],
    ["none among many", ["docs/x.md", "lib"], ["src", "libs/y.ts"], false],
    ["null overlaps everything", null, ["zzz/only.ts"], true],
    ["everything overlaps null", ["zzz/only.ts"], null, true],
    ["[] overlaps everything", [], ["zzz/only.ts"], true],
    ["everything overlaps []", ["zzz/only.ts"], [], true],
    ["null and []", null, [], true],
  ] as const)("%s", (_label, a, b, want) => {
    expect(overlaps(a as string[] | null, b as string[] | null)).toBe(want);
    expect(overlaps(b as string[] | null, a as string[] | null)).toBe(want);
  });
});

const ctx = useRunTokenFixture();

async function goalWith(files: (string[] | null)[]) {
  const w = await world(ctx.db);
  const g = await seedGoal(ctx.db, {
    workspaceId: w.workspaceId,
    projectId: w.projectA,
    status: "approved",
    approvedBy: w.editor,
  });
  const ids: string[] = [];
  for (const f of files)
    ids.push((await seedTask(ctx.db, { goalId: g.id, files: f })).id);
  return { w, ids };
}

const agent = (person: string, n: number) =>
  ctx.server.as({ kind: "agent", agent_id: `fo-${n}`, on_behalf_of: person });
const claim = (person: string, n: number, id: string) =>
  agent(person, n).post(`/api/v1/tasks/${id}/claim`, {});

describe("two ready tasks with overlapping files (bar 5)", () => {
  it("cannot both be in progress: the second claim is 409 files_busy and stays pending", async () => {
    const { w, ids } = await goalWith([
      ["src/a"],
      ["src/a/b.ts"],
      ["src/ab.ts"],
    ]);
    expect((await claim(w.editor, 1, ids[0]!)).status).toBe(200);
    expectError(await claim(w.editor, 2, ids[1]!), 409, "files_busy");
    const got = await ctx.server
      .as(human(w.editor))
      .get(`/api/v1/tasks/${ids[1]}`);
    expect(got.body.task).toMatchObject({
      status: "pending",
      holder: null,
      claim_seq: 0,
    });
    // A shared prefix that is not a folder does not block.
    expect((await claim(w.editor, 2, ids[2]!)).status).toBe(200);
  });

  it("files null overlaps a running task both ways", async () => {
    const { w, ids } = await goalWith([
      null,
      ["zzz/only.ts"],
      [],
      ["yyy/only.ts"],
    ]);
    expect((await claim(w.editor, 1, ids[1]!)).status).toBe(200);
    expectError(await claim(w.editor, 2, ids[0]!), 409, "files_busy");
    expectError(await claim(w.editor, 2, ids[2]!), 409, "files_busy");
    const other = await goalWith([null, ["a.ts"]]);
    expect((await claim(other.w.editor, 1, other.ids[0]!)).status).toBe(200);
    expectError(
      await claim(other.w.editor, 2, other.ids[1]!),
      409,
      "files_busy",
    );
  });

  it("two claims at the same moment: one wins, one gets files_busy", async () => {
    const { w, ids } = await goalWith([["src/a.ts"], ["src"]]);
    const [ra, rb] = await Promise.all([
      claim(w.editor, 1, ids[0]!),
      claim(w.editor, 2, ids[1]!),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expectError(ra.status === 409 ? ra : rb, 409, "files_busy");
  });

  it("a running task whose lease expired no longer blocks", async () => {
    const { w, ids } = await goalWith([["src"], ["src/x.ts"]]);
    expect((await claim(w.editor, 1, ids[0]!)).status).toBe(200);
    expectError(await claim(w.editor, 2, ids[1]!), 409, "files_busy");
    ctx.advance(601);
    expect((await claim(w.editor, 2, ids[1]!)).status).toBe(200);
  });

  it("a task of another project does not block", async () => {
    const { w, ids } = await goalWith([null]);
    const g = await seedGoal(ctx.db, {
      workspaceId: w.workspaceId,
      projectId: w.projectB,
      status: "approved",
      approvedBy: w.editor,
    });
    const b = await seedTask(ctx.db, { goalId: g.id, files: null });
    expect((await claim(w.editor, 1, ids[0]!)).status).toBe(200);
    expect((await claim(w.editor, 2, b.id)).status).toBe(200);
  });
});
