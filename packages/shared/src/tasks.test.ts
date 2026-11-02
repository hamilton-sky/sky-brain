import { describe, expect, it } from "vitest";
import {
  ClaimRequestSchema,
  DoneRequestSchema,
  FailRequestSchema,
  GOAL_EXECUTORS,
  GOAL_STATUSES,
  GoalCreateRequestSchema,
  ProofSchema,
  ReadyQuerySchema,
  TASK_CAPS,
  TASK_EVENT_KINDS,
  TASK_STATUSES,
  TasksAddRequestSchema,
  tooLargeField,
} from "./tasks.ts";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const goal = {
  project_id: PROJECT,
  title: "Ship the board",
  body: "Three tasks.",
  executor: "single",
};
const task = { title: "One", body: "Do one thing." };

describe("enums match the spec's value lists", () => {
  it("goals, tasks and events", () => {
    expect(GOAL_EXECUTORS).toEqual(["single", "loop", "team"]);
    expect(GOAL_STATUSES).toEqual(["draft", "approved", "cancelled"]);
    expect(TASK_STATUSES).toEqual([
      "pending",
      "in_progress",
      "done",
      "failed",
      "blocked",
    ]);
    expect(TASK_EVENT_KINDS).toEqual([
      "created",
      "claimed",
      "renewed",
      "released",
      "done",
      "failed",
      "reclaimed",
    ]);
  });
});

describe("goal create", () => {
  it("accepts a valid goal", () => {
    expect(GoalCreateRequestSchema.safeParse(goal).success).toBe(true);
  });

  it("refuses an unknown field", () => {
    for (const extra of ["actor", "author", "device_id", "status"]) {
      const r = GoalCreateRequestSchema.safeParse({ ...goal, [extra]: "x" });
      expect(r.success, extra).toBe(false);
      expect(tooLargeField(r.error!)).toBeNull();
    }
  });

  it("refuses an over-cap title as too large, naming the field", () => {
    const ok = GoalCreateRequestSchema.safeParse({
      ...goal,
      title: "t".repeat(TASK_CAPS.title),
    });
    expect(ok.success).toBe(true);
    const r = GoalCreateRequestSchema.safeParse({
      ...goal,
      title: "t".repeat(TASK_CAPS.title + 1),
    });
    expect(r.success).toBe(false);
    expect(tooLargeField(r.error!)).toBe("title");
  });

  it("caps the body in UTF-8 bytes, not characters", () => {
    const atCap = "é".repeat(TASK_CAPS.bodyBytes / 2);
    expect(
      GoalCreateRequestSchema.safeParse({ ...goal, body: atCap }).success,
    ).toBe(true);
    const r = GoalCreateRequestSchema.safeParse({ ...goal, body: atCap + "a" });
    expect(r.success).toBe(false);
    expect(tooLargeField(r.error!)).toBe("body");
  });

  it("refuses an empty title and a bad executor as invalid, not too large", () => {
    for (const bad of [{ title: "" }, { executor: "swarm" }]) {
      const r = GoalCreateRequestSchema.safeParse({ ...goal, ...bad });
      expect(r.success).toBe(false);
      expect(tooLargeField(r.error!)).toBeNull();
    }
  });
});

describe("add tasks", () => {
  it("accepts tasks with files, refs, dependencies and attempts", () => {
    const r = TasksAddRequestSchema.safeParse({
      tasks: [
        task,
        {
          ...task,
          lane: "api",
          files: ["src/a.ts"],
          context_refs: ["entry:1"],
          depends_on: [0, PROJECT],
          max_attempts: 10,
        },
        { ...task, files: null },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("refuses an unknown field on a task", () => {
    const r = TasksAddRequestSchema.safeParse({
      tasks: [{ ...task, status: "done" }],
    });
    expect(r.success).toBe(false);
  });

  it("refuses an over-cap files list as too large, naming the field", () => {
    const files = Array.from({ length: TASK_CAPS.files }, (_, i) => `f${i}`);
    expect(
      TasksAddRequestSchema.safeParse({ tasks: [task, { ...task, files }] })
        .success,
    ).toBe(true);
    const r = TasksAddRequestSchema.safeParse({
      tasks: [task, { ...task, files: [...files, "one-more"] }],
    });
    expect(r.success).toBe(false);
    expect(tooLargeField(r.error!)).toBe("tasks.1.files");
  });

  it("refuses an over-cap path, title and count of tasks", () => {
    const long = TasksAddRequestSchema.safeParse({
      tasks: [{ ...task, files: ["p".repeat(TASK_CAPS.filePath + 1)] }],
    });
    expect(tooLargeField(long.error!)).toBe("tasks.0.files.0");
    const title = TasksAddRequestSchema.safeParse({
      tasks: [task, task, { ...task, title: "t".repeat(TASK_CAPS.title + 1) }],
    });
    expect(tooLargeField(title.error!)).toBe("tasks.2.title");
    const many = TasksAddRequestSchema.safeParse({
      tasks: Array.from({ length: TASK_CAPS.tasks + 1 }, () => task),
    });
    expect(tooLargeField(many.error!)).toBe("tasks");
  });

  it("refuses no tasks, max_attempts out of 1..10 and a negative index", () => {
    for (const body of [
      { tasks: [] },
      { tasks: [{ ...task, max_attempts: 0 }] },
      { tasks: [{ ...task, max_attempts: 11 }] },
      { tasks: [{ ...task, depends_on: [-1] }] },
      { tasks: [{ ...task, depends_on: ["not-a-uuid"] }] },
    ]) {
      const r = TasksAddRequestSchema.safeParse(body);
      expect(r.success, JSON.stringify(body)).toBe(false);
      expect(tooLargeField(r.error!)).toBeNull();
    }
  });
});

describe("claim and report", () => {
  it("claim takes an empty object only", () => {
    expect(ClaimRequestSchema.safeParse({}).success).toBe(true);
    expect(ClaimRequestSchema.safeParse({ device_id: PROJECT }).success).toBe(
      false,
    );
  });

  it("done takes a proof; the proof is strict and capped", () => {
    const proof = {
      gates: [{ name: "test", ok: true, summary: "318 passed" }],
      commit: "abc1234",
      pr_url: "https://github.com/o/r/pull/1",
      summary: "Done.",
    };
    expect(DoneRequestSchema.safeParse({ claim_seq: 1, proof }).success).toBe(
      true,
    );
    expect(ProofSchema.safeParse({ ...proof, extra: 1 }).success).toBe(false);
    expect(ProofSchema.safeParse({ commit: "xyz" }).success).toBe(false);
    expect(ProofSchema.safeParse({ pr_url: "http://x.y/1" }).success).toBe(
      false,
    );
    const gates = ProofSchema.safeParse({
      gates: [
        { name: "a", ok: true },
        { name: "b", ok: false, summary: "s".repeat(TASK_CAPS.summary + 1) },
      ],
    });
    expect(tooLargeField(gates.error!)).toBe("gates.1.summary");
  });

  it("fail takes a reason of 1..4000 characters", () => {
    expect(
      FailRequestSchema.safeParse({ claim_seq: 2, reason: "broke" }).success,
    ).toBe(true);
    expect(
      FailRequestSchema.safeParse({ claim_seq: 2, reason: "" }).success,
    ).toBe(false);
    const r = FailRequestSchema.safeParse({
      claim_seq: 2,
      reason: "r".repeat(TASK_CAPS.reason + 1),
    });
    expect(tooLargeField(r.error!)).toBe("reason");
  });
});

describe("ready query", () => {
  it("defaults the limit to 20 and caps it at 100", () => {
    const r = ReadyQuerySchema.safeParse({ project_id: PROJECT });
    expect(r.success && r.data.limit).toBe(20);
    expect(ReadyQuerySchema.safeParse({ limit: "100" }).success).toBe(true);
    const over = ReadyQuerySchema.safeParse({ limit: "101" });
    expect(over.success).toBe(false);
    expect(tooLargeField(over.error!)).toBeNull();
  });
});
