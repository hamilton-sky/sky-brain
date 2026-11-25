// Every bench task, with its split. A third is held out (BOOK.md section 10): never read while
// writing arm B's descriptions or the book, and the decisive C-against-B comparison is on those.
import { approvalTasks } from "./tasks-approval.ts";
import { boardTasks } from "./tasks-board.ts";
import { complexTasks } from "./tasks-complex.ts";
import { memoryTasks } from "./tasks-memory.ts";
import type { BenchTask } from "./task-types.ts";

export type Split = "tune" | "held";
export type TaskSet = "core" | "complex";

/** Fixed by id so adding a task never moves another between splits. */
const HELD = new Set([
  "core-coffee-conflict",
  "long-worklog-scoped",
  "inbox-dark-idea",
  "capture-external",
  "capture-injection",
  "board-empty",
  "board-release",
  "board-attach",
  "board-blocked",
  "approval-status",
  "goal-count",
  "across-before-work",
]);

export const TASKS: (BenchTask & { split: Split; set: TaskSet })[] = [
  ...[...memoryTasks, ...boardTasks, ...approvalTasks].map((t) => ({
    ...t,
    set: "core" as const,
    split: HELD.has(t.id) ? ("held" as const) : ("tune" as const),
  })),
  // Written after the descriptions and the book, so held out by construction.
  ...complexTasks.map((t) => ({
    ...t,
    set: "complex" as const,
    split: "held" as const,
  })),
];
