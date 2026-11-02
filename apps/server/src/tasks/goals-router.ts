// `/api/v1/goals` (cloud-task-board spec.md Routes): create a draft, list, get, and the
// human-only approve, cancel and release. Check order: actor, body and verb (app); humans only
// (approve, cancel, release); the board-write rate limit (every POST); request shape and size
// caps; target and membership (404); role (403); state (409); secrets (422); quarantine.
import type { Role } from "@sky-brain/shared/enums";
import { IdSchema } from "@sky-brain/shared/scope";
import {
  GoalCreateRequestSchema,
  GoalsListQuerySchema,
  tooLargeField,
} from "@sky-brain/shared/tasks";
import { and, eq } from "drizzle-orm";
import express, {
  type Request,
  type RequestHandler,
  type Router,
} from "express";
import type { z } from "zod";
import { actorKey } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { requireHuman } from "../actor/require-human.ts";
import { runContextOf } from "../actor/run-context.ts";
import type { Db, DbOrTx } from "../db/client.ts";
import { features } from "../db/schema.ts";
import type { RateLimiter } from "../guards/ratelimit.ts";
import { HttpError } from "../http/http-error.ts";
import { validate } from "../http/validate.ts";
import { assertRunScope, effectiveRole } from "../run-tokens/run-scope.ts";
import { resolveScope } from "../scope/resolve-scope.ts";
import {
  approveGoal,
  assertAssignable,
  cancelGoal,
  createGoal,
  findGoal,
  goalTasks,
  goalWire,
  listGoals,
  releaseGoal,
} from "./goals-service.ts";
import type { GoalRow } from "./wire.ts";
import { heldBecause, refuseSecrets } from "./write-guards.ts";

export interface GoalsRouterOptions {
  db: Db;
  now: () => Date;
  /** The one board-write limiter `createApp` shares between the board's routers. */
  limiter: RateLimiter;
}

/**
 * Check order step 5 for a board write: one bucket per actor and device (`createApp` makes one
 * limiter for every board write); 429 `rate_limited` with `Retry-After`.
 */
export function boardWriteLimit(limiter: RateLimiter): RequestHandler {
  return (req, res, next) => {
    const device = runContextOf(req)?.deviceId ?? "none";
    const taken = limiter.take(`${actorKey(actorOf(req))}|device:${device}`);
    if (!taken.ok) {
      res.set("Retry-After", String(taken.retryAfterSeconds));
      throw new HttpError(429, "rate_limited", "Too many writes; wait.");
    }
    next();
  };
}

/** Check order step 6: an over-cap value is 413 `too_large` with `field`, else 400. */
export function parseRequest<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const field = tooLargeField(result.error);
    if (field !== null) {
      throw new HttpError(413, "too_large", "A value is over its size cap.", {
        field,
      });
    }
  }
  return validate(schema, value);
}

/** A path `:id` that is not a uuid is 400 `invalid_request`. */
export function pathId(req: Request): string {
  return validate(IdSchema, req.params.id);
}

/** Check order step 8: owners and editors write; a run token's role caps the member's. */
export function assertWriter(req: Request, memberRole: Role): void {
  const role = effectiveRole(req, memberRole);
  if (role !== "owner" && role !== "editor") {
    throw new HttpError(403, "role_cannot_write", "A viewer cannot write.");
  }
}

export function goalsRouter(options: GoalsRouterOptions): Router {
  const { db, now } = options;
  const router = express.Router();
  const limit = boardWriteLimit(options.limiter);

  router.post("/", limit, async (req, res) => {
    const body = parseRequest(GoalCreateRequestSchema, req.body);
    const actor = actorOf(req);
    const scope = await resolveScope(db, actor, {
      project_id: body.project_id,
    });
    const projectId = body.project_id;
    if (body.feature_id !== undefined) {
      const [feature] = await db
        .select({ id: features.id })
        .from(features)
        .where(
          and(
            eq(features.id, body.feature_id),
            eq(features.projectId, projectId),
          ),
        );
      if (!feature) throw new HttpError(404, "not_found", "No such scope.");
    }
    assertRunScope(req, { workspaceId: scope.workspaceId, projectId });
    assertWriter(req, scope.role);
    if (body.assignee !== undefined) {
      if (actor.kind !== "human") {
        throw new HttpError(
          403,
          "agent_cannot_assign",
          "An agent cannot assign a goal.",
        );
      }
      await assertAssignable(db, scope.workspaceId, body.assignee);
    }
    refuseSecrets([
      { name: "title", value: body.title },
      { name: "body", value: body.body },
    ]);
    const t = now();
    const row = await createGoal(
      db,
      actor,
      {
        workspaceId: scope.workspaceId,
        projectId,
        featureId: body.feature_id ?? null,
        body,
        quarantinedBecause: heldBecause(body.title, body.body) ?? null,
        deviceId: runContextOf(req)?.deviceId ?? null,
      },
      t,
    );
    res.status(201).json({ goal: await goalWire(db, actor, row, t) });
  });

  router.get("/", async (req, res) => {
    const query = validate(GoalsListQuerySchema, req.query);
    const actor = actorOf(req);
    const scope = await resolveScope(db, actor, {
      project_id: query.project_id,
    });
    assertRunScope(req, {
      workspaceId: scope.workspaceId,
      projectId: query.project_id,
    });
    res
      .status(200)
      .json({ goals: await listGoals(db, actor, query.project_id, now()) });
  });

  router.get("/:id", async (req, res) => {
    const id = pathId(req);
    const actor = actorOf(req);
    const { goal } = await findGoal(db, actor, id);
    assertRunScope(req, goal);
    const t = now();
    res.status(200).json({
      goal: await goalWire(db, actor, goal, t),
      tasks: await goalTasks(db, actor, goal.id, t),
    });
  });

  /** A human writer's change to one goal, inside a transaction with the goal row locked. */
  const humanWrite = (
    change: (
      tx: DbOrTx,
      req: Request,
      goal: GoalRow,
      t: Date,
    ) => Promise<{ goal: GoalRow; pinned?: number }>,
  ): RequestHandler[] => [
    requireHuman,
    limit,
    async (req, res) => {
      const id = pathId(req);
      const actor = actorOf(req);
      const t = now();
      const done = await db.transaction(async (tx) => {
        const { goal, role } = await findGoal(tx, actor, id, true);
        assertRunScope(req, goal);
        assertWriter(req, role);
        return change(tx, req, goal, t);
      });
      res.status(200).json({
        goal: await goalWire(db, actor, done.goal, t),
        ...(done.pinned === undefined ? {} : { pinned: done.pinned }),
      });
    },
  ];

  router.post(
    "/:id/approve",
    humanWrite((tx, req, goal, t) => approveGoal(tx, actorOf(req), goal, t)),
  );
  router.post(
    "/:id/cancel",
    humanWrite(async (tx, req, goal, t) => ({
      goal: await cancelGoal(tx, actorOf(req), goal, t),
    })),
  );
  router.post(
    "/:id/release",
    humanWrite(async (tx, req, goal, t) => ({
      goal: await releaseGoal(tx, actorOf(req), goal, t),
    })),
  );

  return router;
}
