// `GET /api/v1/tasks/ready` (cloud-task-board spec.md Routes): the tasks the caller may claim now,
// goal oldest first, then position. Check order: verb (app); query shape (400); the project and
// membership, and a run token's project (404).
import { ReadyQuerySchema } from "@sky-brain/shared/tasks";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { RequestHandler } from "express";
import { personOf } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { runContextOf } from "../actor/run-context.ts";
import type { Db, DbOrTx } from "../db/client.ts";
import { goals, taskDeps, tasks } from "../db/schema.ts";
import { HttpError } from "../http/http-error.ts";
import { validate } from "../http/validate.ts";
import { assertRunScope } from "../run-tokens/run-scope.ts";
import { resolveScope } from "../scope/resolve-scope.ts";
import { eligibleTask, runScopeOf } from "./eligibility.ts";
import { toWireTask } from "./wire.ts";

/** `depends_on` of each task, by task id. */
export async function dependsOnMany(
  db: DbOrTx,
  taskIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>(taskIds.map((id) => [id, []]));
  if (taskIds.length === 0) return map;
  const rows = await db
    .select()
    .from(taskDeps)
    .where(inArray(taskDeps.taskId, taskIds));
  for (const row of rows) map.get(row.taskId)?.push(row.dependsOnId);
  return map;
}

export function readyHandler(options: {
  db: Db;
  now: () => Date;
}): RequestHandler {
  const { db, now } = options;
  return async (req, res) => {
    const query = validate(ReadyQuerySchema, req.query);
    const run = runContextOf(req);
    const projectId =
      query.project_id ?? (run?.kind === "run" ? run.projectId : undefined);
    if (projectId === undefined) {
      throw new HttpError(400, "invalid_request", "project_id is required.", {
        field: "project_id",
      });
    }
    const actor = actorOf(req);
    const scope = await resolveScope(db, actor, { project_id: projectId });
    assertRunScope(req, { workspaceId: scope.workspaceId, projectId });
    const t = now();
    const rows = await db
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(goals, eq(goals.id, tasks.goalId))
      .where(
        and(
          eq(tasks.projectId, projectId),
          query.goal_id === undefined
            ? undefined
            : eq(tasks.goalId, query.goal_id),
          eligibleTask({
            person: personOf(actor),
            now: t,
            runScope: runScopeOf(req),
          }),
        ),
      )
      .orderBy(asc(goals.createdAt), asc(goals.id), asc(tasks.position))
      .limit(query.limit);
    const deps = await dependsOnMany(
      db,
      rows.map((r) => r.task.id),
    );
    res.status(200).json({
      tasks: rows.map((r) => toWireTask(r.task, deps.get(r.task.id)!, t)),
    });
  };
}
