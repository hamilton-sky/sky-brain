// Approve or reject many goals at once: one request per goal, one after another, so a refusal
// (say a goal changed since you looked) stops only that goal and is reported by name.
import type { Goal } from "../api.ts";

export type BulkAction = "approve" | "cancel";

export interface BulkResult {
  done: number;
  failed: { title: string; message: string }[];
}

export async function runBulk(
  goals: Goal[],
  run: (goalId: string) => Promise<unknown>,
): Promise<BulkResult> {
  const result: BulkResult = { done: 0, failed: [] };
  for (const goal of goals) {
    try {
      await run(goal.id);
      result.done += 1;
    } catch (e) {
      result.failed.push({
        title: goal.title,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return result;
}

/** One line for the person: what happened, and which goals were refused and why. */
export function describeBulk(action: BulkAction, r: BulkResult): string {
  const verb = action === "approve" ? "Approved" : "Rejected";
  const head = `${verb} ${r.done} ${r.done === 1 ? "goal" : "goals"}.`;
  if (r.failed.length === 0) return head;
  const why = r.failed.map((f) => `"${f.title}": ${f.message}`).join(" ");
  return `${head} ${r.failed.length} could not be ${action === "approve" ? "approved" : "rejected"}. ${why}`;
}
