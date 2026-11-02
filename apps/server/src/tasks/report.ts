// `POST /api/v1/tasks/:id/renew`, `/release` (verb `claim`), `/done` and `/fail` (verb `report`)
// (cloud-task-board spec.md Routes, Design). Each is one transaction around one conditional
// update fenced by the lease: the task in progress, the `claim_seq` sent, the caller's actor,
// person and device as the holder, and a lease that runs out after now. No row: 409
// `lease_lost` (done again by the same holder with the same `claim_seq` is a 200 with no new
// event), then, for renew and done only, 409 `goal_cancelled`. A refused report changes nothing
// and writes no event or audit row.
import {
  DoneRequestSchema,
  FailRequestSchema,
  LeaseRequestSchema,
  type Proof,
} from "@sky-brain/shared/tasks";
import { and, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Request, RequestHandler } from "express";
import { auditActor, personOf } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { runContextOf } from "../actor/run-context.ts";
import { writeAudit } from "../db/audit.ts";
import type { Db, DbOrTx } from "../db/client.ts";
import { goals, taskDeps, tasks } from "../db/schema.ts";
import { HttpError } from "../http/http-error.ts";
import { assertRunScope } from "../run-tokens/run-scope.ts";
import { LEASE_SECONDS } from "./claim.ts";
import { eligibleTask, runScopeOf } from "./eligibility.ts";
import { blockDependents } from "./fail-cascade.ts";
import { assertWriter, parseRequest, pathId } from "./goals-router.ts";
import { dependsOnMany } from "./ready.ts";
import { writeTaskEvent } from "./task-events.ts";
import { findTask } from "./tasks-router.ts";
import { withholdSecrets } from "./write-guards.ts";
import { toWireTask, type TaskRow } from "./wire.ts";

type Verb = "renew" | "release" | "done" | "fail";

interface Fence {
  req: Request;
  id: string;
  claimSeq: number;
  t: Date;
}

/** The caller is the holder of this `claim_seq`: actor, person and device from the token. */
function heldBy({ req, id, claimSeq }: Fence): SQL {
  const actor = actorOf(req);
  const deviceId = runContextOf(req)?.deviceId ?? null;
  return and(
    eq(tasks.id, id),
    eq(tasks.claimSeq, claimSeq),
    eq(tasks.holderActor, auditActor(actor).actor),
    eq(tasks.holderPerson, personOf(actor)),
    sql`${tasks.holderDevice} is not distinct from ${deviceId}::uuid`,
  )!;
}

/** The lease the caller sent is still live. */
const liveLease = (f: Fence): SQL =>
  and(
    heldBy(f),
    eq(tasks.status, "in_progress"),
    gt(tasks.leaseExpiresAt, f.t),
  )!;

const goalOpen = sql`exists (select 1 from ${goals} where ${goals.id} = ${tasks.goalId} and ${goals.status} <> 'cancelled')`;

const noHolder = {
  holderActor: null,
  holderPerson: null,
  holderDevice: null,
  leaseExpiresAt: null,
};

const lost = () =>
  new HttpError(409, "lease_lost", "The lease is gone or not yours.");

/**
 * One conditional update under the fence (renew and done also need the goal not cancelled).
 * No row: 409 `lease_lost`, or `goal_cancelled` when only the goal stood in the way.
 */
async function fencedUpdate(
  tx: DbOrTx,
  f: Fence,
  verb: Verb,
  set: PgUpdateSetSource<typeof tasks>,
): Promise<TaskRow> {
  const needsOpenGoal = verb === "renew" || verb === "done";
  const [row] = await tx
    .update(tasks)
    .set({ ...set, updatedAt: f.t })
    .where(needsOpenGoal ? and(liveLease(f), goalOpen) : liveLease(f))
    .returning();
  if (row) return row;
  const [held] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(liveLease(f));
  if (held && needsOpenGoal) {
    throw new HttpError(409, "goal_cancelled", "The goal was cancelled.");
  }
  throw lost();
}

/** `task.status` audit for a change made by this request. */
async function auditStatus(
  tx: DbOrTx,
  req: Request,
  row: TaskRow,
  to: string,
  via: Verb,
) {
  const who = auditActor(actorOf(req));
  await writeAudit(tx, {
    workspaceId: row.workspaceId,
    actor: who.actor,
    action: "task.status",
    targetId: row.id,
    details: {
      ...who.details,
      goal_id: row.goalId,
      from: "in_progress",
      to,
      via,
      claim_seq: row.claimSeq,
      device_id: runContextOf(req)?.deviceId ?? null,
    },
  });
}

/** Proof with every string passed through `withholdSecrets`. */
function withheldProof(proof: Proof): Proof {
  const w = (s: string | undefined) =>
    s === undefined ? undefined : withholdSecrets(s);
  return JSON.parse(
    JSON.stringify({
      gates: proof.gates?.map((g) => ({
        name: w(g.name),
        ok: g.ok,
        summary: w(g.summary),
      })),
      commit: w(proof.commit),
      pr_url: w(proof.pr_url),
      summary: w(proof.summary),
    }),
  ) as Proof;
}

/** Tasks that wait on `taskId` and the eligibility filter of ready and claim now passes. */
async function newlyReady(tx: DbOrTx, req: Request, taskId: string, t: Date) {
  const rows = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        inArray(
          tasks.id,
          tx
            .select({ id: taskDeps.taskId })
            .from(taskDeps)
            .where(eq(taskDeps.dependsOnId, taskId)),
        ),
        eligibleTask({
          person: personOf(actorOf(req)),
          now: t,
          runScope: runScopeOf(req),
        }),
      ),
    )
    .orderBy(tasks.position);
  return rows.map((r) => r.id);
}

/** Path id, body, transaction: 404 for an unknown or unseen task, 403 for a viewer. */
function reportHandler<B extends { claim_seq: number }, R>(
  options: { db: Db; now: () => Date },
  parse: (body: unknown) => B,
  run: (tx: DbOrTx, f: Fence, body: B, task: TaskRow) => Promise<R>,
  reply: (result: R, t: Date) => unknown,
): RequestHandler {
  const { db, now } = options;
  return async (req, res) => {
    const id = pathId(req);
    const body = parse(req.body ?? {});
    const t = now();
    const result = await db.transaction(async (tx) => {
      const { task, role } = await findTask(tx, actorOf(req), id, true);
      assertRunScope(req, task);
      assertWriter(req, role);
      return run(tx, { req, id, claimSeq: body.claim_seq, t }, body, task);
    });
    res.status(200).json(await reply(result, t));
  };
}

export function reportHandlers(options: { db: Db; now: () => Date }) {
  const { db } = options;
  const wire = async (row: TaskRow, t: Date) =>
    toWireTask(row, (await dependsOnMany(db, [row.id])).get(row.id)!, t);

  const renew = reportHandler(
    options,
    (b) => parseRequest(LeaseRequestSchema, b),
    async (tx, f) => {
      const row = await fencedUpdate(tx, f, "renew", {
        leaseExpiresAt: new Date(f.t.getTime() + LEASE_SECONDS * 1000),
      });
      await writeTaskEvent(tx, {
        task: row,
        kind: "renewed",
        req: f.req,
        at: f.t,
      });
      return row;
    },
    (row) => ({
      lease: {
        claim_seq: row.claimSeq,
        expires_at: row.leaseExpiresAt!.toISOString(),
      },
    }),
  );

  const release = reportHandler(
    options,
    (b) => parseRequest(LeaseRequestSchema, b),
    async (tx, f) => {
      const row = await fencedUpdate(tx, f, "release", {
        status: "pending",
        ...noHolder,
      });
      await writeTaskEvent(tx, {
        task: row,
        kind: "released",
        req: f.req,
        at: f.t,
      });
      await auditStatus(tx, f.req, row, "pending", "release");
      return row;
    },
    async (row, t) => ({ task: await wire(row, t) }),
  );

  const done = reportHandler(
    options,
    (b) => parseRequest(DoneRequestSchema, b),
    async (tx, f, body) => {
      const [again] = await tx
        .select()
        .from(tasks)
        .where(and(heldBy(f), eq(tasks.status, "done")));
      let row = again;
      if (!row) {
        row = await fencedUpdate(tx, f, "done", {
          status: "done",
          proof: withheldProof(body.proof),
        });
        await writeTaskEvent(tx, {
          task: row,
          kind: "done",
          req: f.req,
          at: f.t,
        });
        await auditStatus(tx, f.req, row, "done", "done");
      }
      return { row, ready: await newlyReady(tx, f.req, row.id, f.t) };
    },
    async ({ row, ready }, t) => ({
      task: await wire(row, t),
      newly_ready: ready,
    }),
  );

  const fail = reportHandler(
    options,
    (b) => parseRequest(FailRequestSchema, b),
    async (tx, f, body, task) => {
      // The row is locked (findTask), so its attempts are current.
      const final = task.attempts + 1 >= task.maxAttempts;
      const row = await fencedUpdate(tx, f, "fail", {
        status: final ? "failed" : "pending",
        attempts: sql`${tasks.attempts} + 1`,
        failReason: withholdSecrets(body.reason),
        ...noHolder,
      });
      const blocked = final ? await blockDependents(tx, row, f.req, f.t) : [];
      await writeTaskEvent(tx, {
        task: row,
        kind: "failed",
        req: f.req,
        at: f.t,
        details: final ? { final, blocked } : { final },
      });
      await auditStatus(tx, f.req, row, row.status, "fail");
      return { row, blocked };
    },
    async ({ row, blocked }, t) => ({ task: await wire(row, t), blocked }),
  );

  return { renew, release, done, fail };
}
