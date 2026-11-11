// Maps goal and task rows to the wire `Goal` and `Task` (cloud-task-board spec.md Wire types),
// with the effective task status computed at read time from the app clock (lazy lease expiry).
import {
  TASK_STATUSES,
  type Goal,
  type Task,
  type TaskStatus,
} from "@sky-brain/shared/tasks";
import type { goals, tasks } from "../db/schema.ts";

export type GoalRow = typeof goals.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;

/** The fields the effective status needs. */
type LeaseFields = Pick<TaskRow, "status" | "leaseExpiresAt">;

/** An `in_progress` row whose lease runs out after `now`. */
export function hasLiveLease(row: LeaseFields, now: Date): boolean {
  return (
    row.status === "in_progress" &&
    row.leaseExpiresAt !== null &&
    row.leaseExpiresAt.getTime() > now.getTime()
  );
}

/** An `in_progress` row whose lease is at or before `now` reads `pending`. */
export function effectiveTaskStatus(row: LeaseFields, now: Date): TaskStatus {
  if (row.status === "in_progress" && !hasLiveLease(row, now)) return "pending";
  return row.status;
}

/** Tasks by effective status, every status present. */
export function countTasks(
  rows: LeaseFields[],
  now: Date,
): Record<TaskStatus, number> {
  const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<
    TaskStatus,
    number
  >;
  for (const row of rows) counts[effectiveTaskStatus(row, now)] += 1;
  return counts;
}

export function toWireGoal(
  row: GoalRow,
  counts: Record<TaskStatus, number>,
): Goal {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    project_id: row.projectId,
    feature_id: row.featureId,
    title: row.title,
    body: row.body,
    executor: row.executor,
    status: row.status,
    assignee: row.assignee,
    approved_by: row.approvedBy,
    approved_at: row.approvedAt?.toISOString() ?? null,
    quarantined_because: row.quarantinedBecause,
    author_kind: row.authorKind,
    author: row.author,
    on_behalf_of: row.onBehalfOf,
    counts,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function toWireTask(row: TaskRow, dependsOn: string[], now: Date): Task {
  const live = hasLiveLease(row, now);
  return {
    id: row.id,
    goal_id: row.goalId,
    workspace_id: row.workspaceId,
    project_id: row.projectId,
    title: row.title,
    body: row.body,
    lane: row.lane,
    files: row.files,
    context_refs: row.contextRefs,
    depends_on: dependsOn,
    status: effectiveTaskStatus(row, now),
    attempts: row.attempts,
    max_attempts: row.maxAttempts,
    holder:
      live && row.holderActor !== null
        ? {
            actor: row.holderActor,
            device_id: row.holderDevice,
            lease_expires_at: row.leaseExpiresAt!.toISOString(),
          }
        : null,
    claim_seq: row.claimSeq,
    pinned: row.approvedHash !== null && row.approvedHash === row.textHash,
    quarantined_because: row.quarantinedBecause,
    proof: row.proof,
    fail_reason: row.failReason,
    position: row.position,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
