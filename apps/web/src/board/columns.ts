// Where a goal sits on the card board, and which goals make today's digest. Pure, so the
// rules are tested without a browser (columns.test.ts).
import type { Goal, TaskStatus } from "../api.ts";

export type Column = "needs" | "run" | "wait" | "done";

export const COLUMNS: { id: Column; label: string }[] = [
  { id: "needs", label: "Needs you" },
  { id: "wait", label: "Waiting to start" },
  { id: "run", label: "Running" },
  { id: "done", label: "Done" },
];

/** The digest shows at most this many cards, so a review fits in a minute or two. */
export const DIGEST_SIZE = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isHeld(goal: Goal): boolean {
  return goal.quarantined_because !== null;
}

export function taskTotal(counts: Goal["counts"]): number {
  return (Object.keys(counts) as TaskStatus[]).reduce(
    (n, s) => n + counts[s],
    0,
  );
}

/** The column a goal belongs in; null for a cancelled goal, which leaves the board. */
export function columnOf(goal: Goal): Column | null {
  if (goal.status === "cancelled") return null;
  if (goal.status === "draft" || isHeld(goal)) return "needs";
  const { counts } = goal;
  const total = taskTotal(counts);
  if (total > 0 && counts.done === total) return "done";
  const started =
    counts.done + counts.in_progress + counts.failed + counts.blocked;
  return started > 0 ? "run" : "wait";
}

/** A draft that is not held can be approved in bulk; a held one must be read and released. */
export function canBulkApprove(goal: Goal): boolean {
  return goal.status === "draft" && !isHeld(goal);
}

/** Rejecting cancels the goal; any goal still waiting for you can be rejected. */
export function canReject(goal: Goal): boolean {
  return columnOf(goal) === "needs";
}

export interface Digest {
  /** Up to DIGEST_SIZE goals waiting for you, the longest-waiting first. */
  cards: Goal[];
  /** How many more wait beyond the cards shown. */
  more: number;
  /** Goals agents proposed in the last 24 hours. */
  newToday: number;
  running: number;
  /** Goals still on the board with at least one failed task. */
  withFailures: number;
}

export function digest(goals: Goal[], now: Date): Digest {
  const waiting = goals
    .filter((g) => columnOf(g) === "needs")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const since = now.getTime() - DAY_MS;
  return {
    cards: waiting.slice(0, DIGEST_SIZE),
    more: Math.max(0, waiting.length - DIGEST_SIZE),
    newToday: goals.filter(
      (g) => g.author_kind === "agent" && Date.parse(g.created_at) >= since,
    ).length,
    running: goals.filter((g) => columnOf(g) === "run").length,
    withFailures: goals.filter(
      (g) => columnOf(g) !== null && g.counts.failed > 0,
    ).length,
  };
}
