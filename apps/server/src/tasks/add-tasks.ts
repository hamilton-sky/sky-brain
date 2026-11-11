// `POST /api/v1/goals/:id/tasks` (cloud-task-board spec.md Routes), routed from goals-router.ts
// after the board-write rate limit. Check order: request shape and caps (a `depends_on` index
// must name an earlier task of the request); the goal and membership (404, the goal row locked);
// role (403); state (409 on a cancelled goal); a `depends_on` id must be a task of this goal
// (400); secrets in any task text (422); instruction-like text holds that task. Tasks, deps, a
// `created` event and a `task.create` audit row per task go in one transaction.
import {
  TasksAddRequestSchema,
  type Task,
  type TaskInput,
} from "@sky-brain/shared/tasks";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Request, RequestHandler } from "express";
import { auditActor, personOf } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { runContextOf } from "../actor/run-context.ts";
import { writeAudit } from "../db/audit.ts";
import type { Db, DbOrTx } from "../db/client.ts";
import { taskDeps, tasks } from "../db/schema.ts";
import { HttpError } from "../http/http-error.ts";
import { assertRunScope } from "../run-tokens/run-scope.ts";
import { assertWriter, parseRequest, pathId } from "./goals-router.ts";
import { findGoal } from "./goals-service.ts";
import { taskTextHash } from "./task-text.ts";
import { writeTaskEvent } from "./task-events.ts";
import { toWireTask, type GoalRow } from "./wire.ts";
import { heldBecause, refuseSecrets } from "./write-guards.ts";

const badDependency = (i: number) =>
  new HttpError(
    400,
    "invalid_request",
    "depends_on must name an earlier task of this request by index, or a task of this goal by id.",
    { field: `tasks.${i}.depends_on` },
  );

/** Check order step 6: every index names an earlier task of the same request. */
function assertEarlierIndexes(list: TaskInput[]): void {
  list.forEach((task, i) => {
    for (const dep of task.depends_on ?? []) {
      if (typeof dep === "number" && dep >= i) throw badDependency(i);
    }
  });
}

/** Every id must be a task of this goal the caller can see (an agent never sees a held one). */
async function assertGoalTaskIds(
  tx: DbOrTx,
  req: Request,
  goal: GoalRow,
  list: TaskInput[],
): Promise<void> {
  const ids = [
    ...new Set(
      list.flatMap((t) =>
        (t.depends_on ?? []).filter((d) => typeof d === "string"),
      ),
    ),
  ];
  if (ids.length === 0) return;
  const found = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.goalId, goal.id),
        inArray(tasks.id, ids),
        actorOf(req).kind === "agent"
          ? isNull(tasks.quarantinedBecause)
          : undefined,
      ),
    );
  const known = new Set(found.map((r) => r.id));
  list.forEach((task, i) => {
    for (const dep of task.depends_on ?? []) {
      if (typeof dep === "string" && !known.has(dep)) throw badDependency(i);
    }
  });
}

/** Check order step 10: a secret in any task's title, body, lane, file or context ref. */
function refuseTaskSecrets(list: TaskInput[]): void {
  refuseSecrets(
    list.flatMap((t, i) => [
      { name: `tasks.${i}.title`, value: t.title },
      { name: `tasks.${i}.body`, value: t.body },
      ...(t.lane === undefined
        ? []
        : [{ name: `tasks.${i}.lane`, value: t.lane }]),
      ...(t.files ?? []).map((value, j) => ({
        name: `tasks.${i}.files.${j}`,
        value,
      })),
      ...(t.context_refs ?? []).map((value, j) => ({
        name: `tasks.${i}.context_refs.${j}`,
        value,
      })),
    ]),
  );
}

/** Inside the caller's transaction, with the goal row locked: inserts the checked tasks. */
async function insertTasks(
  tx: DbOrTx,
  req: Request,
  goal: GoalRow,
  list: TaskInput[],
  now: Date,
): Promise<Task[]> {
  const actor = actorOf(req);
  const [last] = await tx
    .select({ max: sql<number>`coalesce(max(${tasks.position}), -1)::int` })
    .from(tasks)
    .where(eq(tasks.goalId, goal.id));
  const start = last!.max + 1;
  const rows = await tx
    .insert(tasks)
    .values(
      list.map((t, i) => {
        const files = t.files ?? null;
        const contextRefs = t.context_refs ?? [];
        return {
          goalId: goal.id,
          workspaceId: goal.workspaceId,
          projectId: goal.projectId,
          title: t.title,
          body: t.body,
          lane: t.lane ?? null,
          files,
          contextRefs,
          maxAttempts: t.max_attempts ?? 3,
          textHash: taskTextHash({
            title: t.title,
            body: t.body,
            files,
            context_refs: contextRefs,
          }),
          // A task added after approval is not pinned until the goal is approved again.
          approvedHash: null,
          quarantinedBecause: heldBecause(t.title, t.body) ?? null,
          position: start + i,
          authorKind: actor.kind,
          author: actor.kind === "human" ? actor.user_id : actor.agent_id,
          onBehalfOf: personOf(actor),
          createdAt: now,
          updatedAt: now,
        };
      }),
    )
    .returning();
  rows.sort((a, b) => a.position - b.position);
  const dependsOn = list.map((t) => [
    ...new Set(
      (t.depends_on ?? []).map((d) =>
        typeof d === "number" ? rows[d]!.id : d,
      ),
    ),
  ]);
  const depRows = rows.flatMap((row, i) =>
    dependsOn[i]!.map((dependsOnId) => ({ taskId: row.id, dependsOnId })),
  );
  if (depRows.length > 0) await tx.insert(taskDeps).values(depRows);
  const who = auditActor(actor);
  const deviceId = runContextOf(req)?.deviceId;
  for (const row of rows) {
    await writeTaskEvent(tx, { task: row, kind: "created", req, at: now });
    await writeAudit(tx, {
      workspaceId: goal.workspaceId,
      actor: who.actor,
      action: "task.create",
      targetId: row.id,
      details: {
        ...who.details,
        goal_id: goal.id,
        ...(deviceId ? { device_id: deviceId } : {}),
        ...(row.quarantinedBecause
          ? { quarantined_because: row.quarantinedBecause }
          : {}),
      },
    });
  }
  return rows.map((row, i) => toWireTask(row, dependsOn[i]!, now));
}

/** The handler; the router puts the board-write limit in front of it. */
export function addTasksHandler(options: {
  db: Db;
  now: () => Date;
}): RequestHandler {
  const { db, now } = options;
  return async (req, res) => {
    const id = pathId(req);
    const body = parseRequest(TasksAddRequestSchema, req.body);
    assertEarlierIndexes(body.tasks);
    const actor = actorOf(req);
    const t = now();
    const made = await db.transaction(async (tx) => {
      const { goal, role } = await findGoal(tx, actor, id, true);
      assertRunScope(req, goal);
      assertWriter(req, role);
      if (goal.status === "cancelled") {
        throw new HttpError(
          409,
          "invalid_state",
          "Tasks cannot be added to a cancelled goal.",
        );
      }
      await assertGoalTaskIds(tx, req, goal, body.tasks);
      refuseTaskSecrets(body.tasks);
      return insertTasks(tx, req, goal, body.tasks, t);
    });
    res.status(201).json({ tasks: made });
  };
}
