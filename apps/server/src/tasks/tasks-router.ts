// `/api/v1/tasks` (cloud-task-board spec.md Routes): get one task, and the human-only
// release-text. Ready and claim join it in ticket 06, renew and report in 07. Check order: actor,
// body and verb (app); humans only (release-text); the board-write rate limit (every POST); the
// path id; target and membership (404, also for an agent on a held task or a task of a held
// goal); role (403); state (409).
import type { Actor } from "@sky-brain/shared/actor";
import type { Role } from "@sky-brain/shared/enums";
import { eq } from "drizzle-orm";
import express, { type Router } from "express";
import { auditActor } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { requireHuman } from "../actor/require-human.ts";
import { writeAudit } from "../db/audit.ts";
import type { Db, DbOrTx } from "../db/client.ts";
import { goals, taskDeps, tasks } from "../db/schema.ts";
import type { RateLimiter } from "../guards/ratelimit.ts";
import { HttpError } from "../http/http-error.ts";
import { assertRunScope } from "../run-tokens/run-scope.ts";
import { memberRole } from "../scope/member-role.ts";
import { assertWriter, boardWriteLimit, pathId } from "./goals-router.ts";
import { goalNotFound } from "./goals-service.ts";
import { toWireTask, type TaskRow } from "./wire.ts";

export interface TasksRouterOptions {
  db: Db;
  now: () => Date;
  /** The one board-write limiter `createApp` shares between the board's routers. */
  limiter: RateLimiter;
}

/**
 * The task and the caller's member role in its workspace. 404 when it does not exist, the person
 * is not a member, or the caller is an agent and the task or its goal is held. `forUpdate` locks
 * the task row until the transaction ends.
 */
export async function findTask(
  db: DbOrTx,
  actor: Actor,
  id: string,
  forUpdate = false,
): Promise<{ task: TaskRow; role: Role }> {
  const query = db
    .select({ task: tasks, goalHeld: goals.quarantinedBecause })
    .from(tasks)
    .innerJoin(goals, eq(goals.id, tasks.goalId))
    .where(eq(tasks.id, id));
  const [row] = await (forUpdate ? query.for("update", { of: tasks }) : query);
  if (
    !row ||
    (actor.kind === "agent" &&
      (row.task.quarantinedBecause !== null || row.goalHeld !== null))
  ) {
    throw goalNotFound();
  }
  const role = await memberRole(db, row.task.workspaceId, actor);
  if (!role) throw goalNotFound();
  return { task: row.task, role };
}

async function dependsOn(db: DbOrTx, taskId: string): Promise<string[]> {
  const rows = await db
    .select({ id: taskDeps.dependsOnId })
    .from(taskDeps)
    .where(eq(taskDeps.taskId, taskId));
  return rows.map((r) => r.id);
}

export function tasksRouter(options: TasksRouterOptions): Router {
  const { db, now } = options;
  const router = express.Router();
  const limit = boardWriteLimit(options.limiter);

  router.get("/:id", async (req, res) => {
    const id = pathId(req);
    const { task } = await findTask(db, actorOf(req), id);
    assertRunScope(req, task);
    res
      .status(200)
      .json({ task: toWireTask(task, await dependsOn(db, task.id), now()) });
  });

  router.post("/:id/release-text", requireHuman, limit, async (req, res) => {
    const id = pathId(req);
    const actor = actorOf(req);
    const t = now();
    const row = await db.transaction(async (tx) => {
      const { task, role } = await findTask(tx, actor, id, true);
      assertRunScope(req, task);
      assertWriter(req, role);
      if (task.quarantinedBecause === null) {
        throw new HttpError(409, "invalid_state", "The task is not held.");
      }
      const [updated] = await tx
        .update(tasks)
        .set({ quarantinedBecause: null, updatedAt: t })
        .where(eq(tasks.id, task.id))
        .returning();
      const who = auditActor(actor);
      await writeAudit(tx, {
        workspaceId: task.workspaceId,
        actor: who.actor,
        action: "task.release_text",
        targetId: task.id,
        details: {
          ...who.details,
          goal_id: task.goalId,
          quarantined_because: task.quarantinedBecause,
        },
      });
      return updated!;
    });
    res
      .status(200)
      .json({ task: toWireTask(row, await dependsOn(db, row.id), t) });
  });

  return router;
}
