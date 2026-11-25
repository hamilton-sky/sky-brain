// `/api/v1/approvals` (D31): an agent (or a person) asks for approval of exact goals or entries;
// only a person, in their own session, approves or rejects. Check order: actor; humans only
// (approve, reject); the board-write rate limit; request shape; run tokens refused; target and
// membership (404); role (403); state (409, 410).
import type { Actor } from "@sky-brain/shared/actor";
import { ApprovalCreateRequestSchema } from "@sky-brain/shared/approvals";
import express, { type Request, type Router } from "express";
import { actorOf } from "@sky-brain/kernel/actor/middleware";
import { requireHuman } from "@sky-brain/kernel/actor/require-human";
import { runContextOf } from "@sky-brain/kernel/actor/run-context";
import type { Db } from "@sky-brain/db/client";
import type { RateLimiter } from "@sky-brain/kernel/guards/ratelimit";
import { HttpError } from "@sky-brain/kernel/http/http-error";
import type { Push } from "../push/push.ts";
import {
  assertWriter,
  boardWriteLimit,
  parseRequest,
  pathId,
} from "@sky-brain/kernel/http/request-checks";
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
  /** Alerts the person when an agent asks. Default: none. */
  push?: Push;
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
  push,
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
    // Awaited, not fired and forgotten: a serverless function may stop once it has answered.
    if (push && actor.kind === "agent") {
      await push
        .notify(db, row.onBehalfOf, {
          title: "sky-brain",
          body: "An agent is waiting for your approval.",
          path: `/a/${row.id}`,
          approval_id: row.id,
          items: row.items.length,
        })
        .catch(() => {});
    }
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
