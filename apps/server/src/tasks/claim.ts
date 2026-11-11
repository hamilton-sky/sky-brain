// `POST /api/v1/tasks/:id/claim` (cloud-task-board spec.md Routes, Design): a 600-second lease
// with a rising `claim_seq`. One transaction: the task and the caller's role (404, 403), the
// per-project advisory lock, the task locked and checked eligible, file overlap with the
// project's live leases (409 `files_busy`), then one conditional update. A refused claim
// changes nothing and writes no event or audit row.
import { ClaimRequestSchema } from "@sky-brain/shared/tasks";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import type { Request, RequestHandler } from "express";
import { auditActor, personOf } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { runContextOf } from "../actor/run-context.ts";
import { writeAudit } from "../db/audit.ts";
import type { Db, DbOrTx } from "../db/client.ts";
import { tasks } from "../db/schema.ts";
import { HttpError } from "../http/http-error.ts";
import { assertRunScope } from "../run-tokens/run-scope.ts";
import { eligibleTask, runScopeOf } from "./eligibility.ts";
import { overlaps } from "./file-overlap.ts";
import { assertWriter, parseRequest, pathId } from "./goals-router.ts";
import { dependsOnMany } from "./ready.ts";
import { writeTaskEvent } from "./task-events.ts";
import { findTask } from "./tasks-router.ts";
import {
  effectiveTaskStatus,
  hasLiveLease,
  toWireTask,
  type TaskRow,
} from "./wire.ts";

export const LEASE_SECONDS = 600;

/** 409 `files_busy` when another task of the project holds a live lease on an overlapping path. */
async function assertFilesFree(tx: DbOrTx, task: TaskRow, now: Date) {
  const running = await tx
    .select({ files: tasks.files })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, task.projectId),
        ne(tasks.id, task.id),
        eq(tasks.status, "in_progress"),
        gt(tasks.leaseExpiresAt, now),
      ),
    );
  if (running.some((r) => overlaps(task.files, r.files))) {
    throw new HttpError(
      409,
      "files_busy",
      "A running task holds an overlapping file.",
    );
  }
}

function refused(task: TaskRow, now: Date): HttpError {
  return hasLiveLease(task, now)
    ? new HttpError(409, "already_claimed", "The task is held by a live lease.")
    : new HttpError(409, "not_ready", "The task is not ready.");
}

async function claimTask(tx: DbOrTx, req: Request, id: string, t: Date) {
  const actor = actorOf(req);
  const { task, role } = await findTask(tx, actor, id);
  assertRunScope(req, task);
  assertWriter(req, role);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`task-claim:${task.projectId}`}, 0))`,
  );
  const eligible = and(
    eq(tasks.id, id),
    eligibleTask({
      person: personOf(actor),
      now: t,
      runScope: runScopeOf(req),
    }),
  );
  const [before] = await tx.select().from(tasks).where(eligible).for("update");
  if (!before) {
    const [current] = await tx.select().from(tasks).where(eq(tasks.id, id));
    throw refused(current ?? task, t);
  }
  await assertFilesFree(tx, before, t);
  const who = auditActor(actor);
  const deviceId = runContextOf(req)?.deviceId ?? null;
  const [after] = await tx
    .update(tasks)
    .set({
      status: "in_progress",
      holderActor: who.actor,
      holderPerson: personOf(actor),
      holderDevice: deviceId,
      leaseExpiresAt: new Date(t.getTime() + LEASE_SECONDS * 1000),
      claimSeq: sql`${tasks.claimSeq} + 1`,
      updatedAt: t,
    })
    .where(eligible)
    .returning();
  if (!after) throw refused(before, t);
  if (before.status === "in_progress") {
    await writeTaskEvent(tx, {
      task: after,
      kind: "reclaimed",
      req,
      at: t,
      details: {
        from_actor: before.holderActor,
        from_device: before.holderDevice,
        from_claim_seq: before.claimSeq,
      },
    });
  }
  await writeTaskEvent(tx, { task: after, kind: "claimed", req, at: t });
  await writeAudit(tx, {
    workspaceId: after.workspaceId,
    actor: who.actor,
    action: "task.status",
    targetId: after.id,
    details: {
      ...who.details,
      goal_id: after.goalId,
      from: effectiveTaskStatus(before, t),
      to: "in_progress",
      via: "claim",
      claim_seq: after.claimSeq,
      device_id: deviceId,
    },
  });
  return after;
}

export function claimHandler(options: {
  db: Db;
  now: () => Date;
}): RequestHandler {
  const { db, now } = options;
  return async (req, res) => {
    const id = pathId(req);
    parseRequest(ClaimRequestSchema, req.body ?? {});
    const t = now();
    const row = await db.transaction((tx) => claimTask(tx, req, id, t));
    const deps = await dependsOnMany(db, [row.id]);
    res.status(200).json({
      task: toWireTask(row, deps.get(row.id)!, t),
      lease: {
        claim_seq: row.claimSeq,
        expires_at: row.leaseExpiresAt!.toISOString(),
      },
    });
  };
}
