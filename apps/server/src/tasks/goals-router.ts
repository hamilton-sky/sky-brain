// `/api/v1/goals` (cloud-task-board spec.md Routes): create a draft, list, get, and the
// human-only approve, cancel and release. Check order: actor, body and verb (app); humans only
// (approve, cancel, release); the board-write rate limit (every POST); request shape and size
// caps; target and membership (404); role (403); state (409); secrets (422); quarantine.
import { IdSchema } from "@sky-brain/shared/scope";
import { AttachDocumentRequestSchema } from "@sky-brain/shared/goal-docs";
import {
  GoalCreateRequestSchema,
  GoalsListQuerySchema,
} from "@sky-brain/shared/tasks";
import { and, eq } from "drizzle-orm";
import express, {
  type Request,
  type RequestHandler,
  type Router,
} from "express";
import { actorOf } from "../actor/middleware.ts";
import { requireHuman } from "../actor/require-human.ts";
import { runContextOf } from "../actor/run-context.ts";
import type { Db, DbOrTx } from "../db/client.ts";
import { features } from "../db/schema.ts";
import type { RateLimiter } from "../guards/ratelimit.ts";
import { HttpError } from "../http/http-error.ts";
import {
  assertWriter,
  boardWriteLimit,
  parseRequest,
  pathId,
} from "../http/request-checks.ts";
import { validate } from "../http/validate.ts";
import { assertRunScope } from "../run-tokens/run-scope.ts";
import { resolveScope } from "../scope/resolve-scope.ts";
import { addTasksHandler } from "./add-tasks.ts";
import { attachDocument, detachDocument, documentsOf } from "./goal-docs.ts";
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
import { heldBecause, refuseSecrets } from "../guards/write-guards.ts";

export interface GoalsRouterOptions {
  db: Db;
  now: () => Date;
  /** The one board-write limiter `createApp` shares between the board's routers. */
  limiter: RateLimiter;
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
    const list = await listGoals(db, actor, query.project_id, now());
    const docs = await documentsOf(
      db,
      actor,
      list.map((g) => g.id),
    );
    res.status(200).json({
      goals: list,
      // Each goal's attached documents (summaries only), by goal id.
      documents: Object.fromEntries(docs),
    });
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
      documents: (await documentsOf(db, actor, [goal.id])).get(goal.id) ?? [],
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

  router.post("/:id/tasks", limit, addTasksHandler({ db, now }));

  /** A writer's change to one goal's documents, with the goal row locked. */
  const writeGoal = (
    req: Request,
    id: string,
    change: (tx: DbOrTx, goal: GoalRow) => Promise<void>,
  ) =>
    db.transaction(async (tx) => {
      const { goal, role } = await findGoal(tx, actorOf(req), id, true);
      assertRunScope(req, goal);
      assertWriter(req, role);
      await change(tx, goal);
    });

  /** Attach an entry the caller may read to a goal; people and agents who may write. */
  router.post("/:id/documents", limit, async (req, res) => {
    const id = pathId(req);
    const body = parseRequest(AttachDocumentRequestSchema, req.body);
    const actor = actorOf(req);
    await writeGoal(req, id, (tx, goal) =>
      attachDocument(tx, actor, goal, body.entry_id, now()),
    );
    res.status(200).json({
      documents: (await documentsOf(db, actor, [id])).get(id) ?? [],
    });
  });

  /** Only a person removes a document from a goal; the entry itself stays. */
  router.delete(
    "/:id/documents/:entryId",
    requireHuman,
    limit,
    async (req, res) => {
      const id = pathId(req);
      const entryId = validate(IdSchema, req.params.entryId);
      await writeGoal(req, id, (tx, goal) =>
        detachDocument(tx, actorOf(req), goal, entryId),
      );
      res.status(204).end();
    },
  );

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
