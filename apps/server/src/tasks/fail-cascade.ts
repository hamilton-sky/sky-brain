// A task failed for the last time (cloud-task-board spec.md Stories "A worker pulls, claims and
// reports"): every pending task that depends on it, directly or not, becomes `blocked`, inside
// the caller's transaction, with a `task.status` audit row each.
import { and, eq, sql } from "drizzle-orm";
import type { Request } from "express";
import { auditActor } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { runContextOf } from "../actor/run-context.ts";
import { writeAudit } from "../db/audit.ts";
import type { DbOrTx } from "../db/client.ts";
import { tasks } from "../db/schema.ts";

/** Every task that depends on `taskId` through `task_deps`, at any depth. */
const dependentsOf = (taskId: string) =>
  sql`${tasks.id} in (with recursive "dependents"("id") as (select "task_id" from "task_deps" where "depends_on_id" = ${taskId} union select "d"."task_id" from "task_deps" as "d" join "dependents" as "x" on "d"."depends_on_id" = "x"."id") select "id" from "dependents")`;

/** Marks the pending dependents of `failed` blocked; returns their ids. */
export async function blockDependents(
  tx: DbOrTx,
  failed: { id: string; claimSeq: number },
  req: Request,
  at: Date,
): Promise<string[]> {
  const blocked = await tx
    .update(tasks)
    .set({ status: "blocked", updatedAt: at })
    .where(and(eq(tasks.status, "pending"), dependentsOf(failed.id)))
    .returning({
      id: tasks.id,
      workspaceId: tasks.workspaceId,
      goalId: tasks.goalId,
    });
  const who = auditActor(actorOf(req));
  for (const row of blocked) {
    await writeAudit(tx, {
      workspaceId: row.workspaceId,
      actor: who.actor,
      action: "task.status",
      targetId: row.id,
      details: {
        ...who.details,
        goal_id: row.goalId,
        from: "pending",
        to: "blocked",
        via: "fail",
        failed_task: failed.id,
        claim_seq: failed.claimSeq,
        device_id: runContextOf(req)?.deviceId ?? null,
      },
    });
  }
  return blocked.map((r) => r.id);
}
