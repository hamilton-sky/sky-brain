// `/api/v1/approvals` (D31): an agent (or a person) asks for approval of exact goals or entries;
// only a person, in their own session, approves or rejects. Check order: actor; humans only
// (approve, reject); the board-write rate limit; request shape; run tokens refused; target and
// membership (404); role (403); state (409, 410).
import type { Actor } from "@sky-brain/shared/actor";
import { ApprovalCreateRequestSchema } from "@sky-brain/shared/approvals";
import express, { type Request, type Router } from "express";
import { actorOf } from "../actor/middleware.ts";
import { requireHuman } from "../actor/require-human.ts";
import { runContextOf } from "../actor/run-context.ts";
import type { Db } from "../db/client.ts";
import type { RateLimiter } from "../guards/ratelimit.ts";
import { HttpError } from "../http/http-error.ts";
import {
  assertWriter,
  boardWriteLimit,
  parseRequest,
  pathId,
} from "../tasks/goals-router.ts";
import {
  approvalWire,
  createApproval,
  decideApproval,
  findApproval,
  listPending,
} from "./approvals-service.ts";

export interface ApprovalsRouterOptions {
  db: Db;
  now: () => Date;
  limiter: RateLimiter;
}

/** Run and device tokens act for a task, not for the person's whole brain: 403. */
function refuseRunTokens(req: Request): void {
  if (runContextOf(req)) {
    throw new HttpError(
      403,
      "run_token_refused",
      "A run token cannot ask for or read approvals.",
    );
  }
}

function human(actor: Actor): Actor & { kind: "human" } {
  if (actor.kind !== "human") {
    throw new HttpError(403, "humans_only", "Only a person can do this.");
  }
  return actor;
}

export function approvalsRouter({
  db,
  now,
  limiter,
}: ApprovalsRouterOptions): Router {
  const router = express.Router();
  const limit = boardWriteLimit(limiter);

  router.post("/", limit, async (req, res) => {
    const body = parseRequest(ApprovalCreateRequestSchema, req.body);
    refuseRunTokens(req);
    const actor = actorOf(req);
    const t = now();
    const row = await createApproval(
      db,
      actor,
      body,
      (role) => assertWriter(req, role),
      t,
    );
    res.status(201).json({ approval: await approvalWire(db, actor, row, t) });
  });

  router.get("/", async (req, res) => {
    refuseRunTokens(req);
    const actor = actorOf(req);
    const t = now();
    const rows = await listPending(db, actor, t);
    res.status(200).json({
      approvals: await Promise.all(
        rows.map((r) => approvalWire(db, actor, r, t)),
      ),
    });
  });

  router.get("/:id", async (req, res) => {
    const id = pathId(req);
    refuseRunTokens(req);
    const actor = actorOf(req);
    const { row } = await findApproval(db, actor, id);
    res
      .status(200)
      .json({ approval: await approvalWire(db, actor, row, now()) });
  });

  /** Approve or reject: people only, owners and editors, in their own session. */
  const decision =
    (to: "approved" | "rejected"): express.RequestHandler =>
    async (req, res) => {
      const actor = human(actorOf(req));
      const t = now();
      const row = await decideApproval(
        db,
        actor,
        pathId(req),
        to,
        (role) => assertWriter(req, role),
        t,
      );
      res.status(200).json({ approval: await approvalWire(db, actor, row, t) });
    };
  router.post("/:id/approve", requireHuman, limit, decision("approved"));
  router.post("/:id/reject", requireHuman, limit, decision("rejected"));

  return router;
}
