// The goals' database work (cloud-task-board spec.md Routes): load a goal the caller may see,
// list and view goals, and create, approve, cancel and release one with its audit row. The
// router (goals-router.ts) does the request checks around these, in the spec's Check order.
import type { Actor } from "@sky-brain/shared/actor";
import type { Role } from "@sky-brain/shared/enums";
import type {
  Goal,
  GoalCreateRequest,
  Task,
  TaskStatus,
} from "@sky-brain/shared/tasks";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { auditActor, personOf } from "../actor/keys.ts";
import { writeAudit } from "../db/audit.ts";
import type { Db, DbOrTx } from "../db/client.ts";
import { goals, members, taskDeps, tasks } from "../db/schema.ts";
import { HttpError } from "../http/http-error.ts";
import { memberRole } from "../scope/member-role.ts";
import { liveTextHash } from "./eligibility.ts";
import { countTasks, toWireGoal, toWireTask, type GoalRow } from "./wire.ts";

const isAgent = (actor: Actor) => actor.kind === "agent";

export const goalNotFound = () =>
  new HttpError(404, "not_found", "No such goal or task.");

/**
 * The goal and the caller's member role in its workspace. 404 when it does not exist, the
 * person is not a member, or the caller is an agent and the goal is held. `forUpdate` locks the
 * row until the transaction ends.
 */
export async function findGoal(
  db: DbOrTx,
  actor: Actor,
  id: string,
  forUpdate = false,
): Promise<{ goal: GoalRow; role: Role }> {
  const query = db.select().from(goals).where(eq(goals.id, id));
  const [goal] = await (forUpdate ? query.for("update") : query);
  if (!goal || (isAgent(actor) && goal.quarantinedBecause !== null)) {
    throw goalNotFound();
  }
  const role = await memberRole(db, goal.workspaceId, actor);
  if (!role) throw goalNotFound();
  return { goal, role };
}

/** Agents never see held tasks. */
const visibleTasks = (actor: Actor): SQL | undefined =>
  isAgent(actor) ? isNull(tasks.quarantinedBecause) : undefined;

async function countsFor(
  db: DbOrTx,
  actor: Actor,
  goalIds: string[],
  now: Date,
): Promise<Map<string, Record<TaskStatus, number>>> {
  const rows = goalIds.length
    ? await db
        .select({
          goalId: tasks.goalId,
          status: tasks.status,
          leaseExpiresAt: tasks.leaseExpiresAt,
        })
        .from(tasks)
        .where(and(inArray(tasks.goalId, goalIds), visibleTasks(actor)))
    : [];
  return new Map(
    goalIds.map((id) => [
      id,
      countTasks(
        rows.filter((r) => r.goalId === id),
        now,
      ),
    ]),
  );
}

export async function goalWire(
  db: DbOrTx,
  actor: Actor,
  goal: GoalRow,
  now: Date,
): Promise<Goal> {
  const counts = await countsFor(db, actor, [goal.id], now);
  return toWireGoal(goal, counts.get(goal.id)!);
}

/** A project's goals, newest first; an agent sees no held goal. */
export async function listGoals(
  db: DbOrTx,
  actor: Actor,
  projectId: string,
  now: Date,
): Promise<Goal[]> {
  const rows = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.projectId, projectId),
        isAgent(actor) ? isNull(goals.quarantinedBecause) : undefined,
      ),
    )
    .orderBy(desc(goals.createdAt), desc(goals.id));
  const counts = await countsFor(
    db,
    actor,
    rows.map((g) => g.id),
    now,
  );
  return rows.map((g) => toWireGoal(g, counts.get(g.id)!));
}

/** The goal's tasks by position, each with its dependencies; an agent sees no held task. */
export async function goalTasks(
  db: DbOrTx,
  actor: Actor,
  goalId: string,
  now: Date,
): Promise<Task[]> {
  const rows = (
    await db
      .select({ task: tasks, liveHash: liveTextHash })
      .from(tasks)
      .where(and(eq(tasks.goalId, goalId), visibleTasks(actor)))
      .orderBy(asc(tasks.position), asc(tasks.id))
  ).map((r) => ({ ...r.task, textHash: r.liveHash }));
  const deps = rows.length
    ? await db
        .select()
        .from(taskDeps)
        .where(
          inArray(
            taskDeps.taskId,
            rows.map((t) => t.id),
          ),
        )
    : [];
  return rows.map((t) =>
    toWireTask(
      t,
      deps.filter((d) => d.taskId === t.id).map((d) => d.dependsOnId),
      now,
    ),
  );
}

/** 400 `invalid_request` on `assignee` unless that user is an owner or editor of the workspace. */
export async function assertAssignable(
  db: DbOrTx,
  workspaceId: string,
  assignee: string,
): Promise<void> {
  const [row] = await db
    .select({ role: members.role })
    .from(members)
    .where(
      and(eq(members.workspaceId, workspaceId), eq(members.userId, assignee)),
    );
  if (row?.role !== "owner" && row?.role !== "editor") {
    throw new HttpError(
      400,
      "invalid_request",
      "The assignee must be an owner or editor of the workspace.",
      { field: "assignee" },
    );
  }
}

export interface NewGoal {
  workspaceId: string;
  projectId: string;
  featureId: string | null;
  body: GoalCreateRequest;
  quarantinedBecause: string | null;
  deviceId: string | null;
}

/** Inserts a `draft` goal and its `goal.create` audit row in one transaction. */
export async function createGoal(
  db: Db,
  actor: Actor,
  goal: NewGoal,
  now: Date,
): Promise<GoalRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(goals)
      .values({
        workspaceId: goal.workspaceId,
        projectId: goal.projectId,
        featureId: goal.featureId,
        title: goal.body.title,
        body: goal.body.body,
        executor: goal.body.executor,
        status: "draft",
        assignee: goal.body.assignee ?? null,
        quarantinedBecause: goal.quarantinedBecause,
        authorKind: actor.kind,
        author: actor.kind === "human" ? actor.user_id : actor.agent_id,
        onBehalfOf: personOf(actor),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const who = auditActor(actor);
    await writeAudit(tx, {
      workspaceId: goal.workspaceId,
      actor: who.actor,
      action: "goal.create",
      targetId: row!.id,
      details: {
        ...who.details,
        project_id: goal.projectId,
        status: "draft",
        ...(goal.deviceId ? { device_id: goal.deviceId } : {}),
        ...(goal.quarantinedBecause
          ? { quarantined_because: goal.quarantinedBecause }
          : {}),
      },
    });
    return row!;
  });
}

const invalidState = (message: string) =>
  new HttpError(409, "invalid_state", message);

async function audit(
  tx: DbOrTx,
  actor: Actor,
  goal: GoalRow,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  const who = auditActor(actor);
  await writeAudit(tx, {
    workspaceId: goal.workspaceId,
    actor: who.actor,
    action,
    targetId: goal.id,
    details: { ...who.details, ...details },
  });
}

/**
 * Inside the caller's transaction, with the goal row locked: 409 `invalid_state` for a cancelled
 * goal, then 409 `quarantined` while the goal or any of its tasks is held; else approves and pins
 * every task whose text is not pinned yet. Returns how many tasks it pinned.
 */
export async function approveGoal(
  tx: DbOrTx,
  actor: Actor,
  goal: GoalRow,
  now: Date,
): Promise<{ goal: GoalRow; pinned: number }> {
  if (goal.status === "cancelled") {
    throw invalidState("A cancelled goal cannot be approved.");
  }
  const [heldTask] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.goalId, goal.id), isNotNull(tasks.quarantinedBecause)))
    .limit(1);
  if (goal.quarantinedBecause !== null || heldTask) {
    throw new HttpError(
      409,
      "quarantined",
      "The goal or one of its tasks is held; a person must release it first.",
    );
  }
  // Pins the text as it is now, hashed in SQL, so a stale `text_hash` (a direct database edit)
  // is corrected here too and the task can be claimed again.
  const pinned = await tx
    .update(tasks)
    .set({ textHash: liveTextHash, approvedHash: liveTextHash, updatedAt: now })
    .where(
      and(
        eq(tasks.goalId, goal.id),
        or(
          sql`${tasks.approvedHash} is distinct from ${liveTextHash}`,
          sql`${tasks.textHash} <> ${liveTextHash}`,
        ),
      ),
    )
    .returning({ id: tasks.id });
  const [row] = await tx
    .update(goals)
    .set({
      status: "approved",
      approvedBy: personOf(actor),
      approvedAt: now,
      updatedAt: now,
    })
    .where(eq(goals.id, goal.id))
    .returning();
  await audit(tx, actor, goal, "goal.approve", {
    from: goal.status,
    pinned: pinned.length,
  });
  return { goal: row!, pinned: pinned.length };
}

/** 409 `invalid_state` when already cancelled. */
export async function cancelGoal(
  tx: DbOrTx,
  actor: Actor,
  goal: GoalRow,
  now: Date,
): Promise<GoalRow> {
  if (goal.status === "cancelled") {
    throw invalidState("The goal is already cancelled.");
  }
  const [row] = await tx
    .update(goals)
    .set({ status: "cancelled", updatedAt: now })
    .where(eq(goals.id, goal.id))
    .returning();
  await audit(tx, actor, goal, "goal.cancel", { from: goal.status });
  return row!;
}

/** Clears `quarantined_because`; 409 `invalid_state` when the goal is not held. */
export async function releaseGoal(
  tx: DbOrTx,
  actor: Actor,
  goal: GoalRow,
  now: Date,
): Promise<GoalRow> {
  if (goal.quarantinedBecause === null) {
    throw invalidState("The goal is not held.");
  }
  const [row] = await tx
    .update(goals)
    .set({ quarantinedBecause: null, updatedAt: now })
    .where(eq(goals.id, goal.id))
    .returning();
  await audit(tx, actor, goal, "goal.release", {
    quarantined_because: goal.quarantinedBecause,
  });
  return row!;
}
