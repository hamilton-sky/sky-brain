// `/api/v1/push` (D33): the VAPID public key, and a person's own subscribe and unsubscribe.
// People only: agents and run tokens never subscribe anyone.
import {
  PushSubscribeRequestSchema,
  PushUnsubscribeRequestSchema,
} from "@sky-brain/shared/approvals";
import { and, eq } from "drizzle-orm";
import express, { type Router } from "express";
import { actorOf } from "../actor/middleware.ts";
import { requireHuman } from "../actor/require-human.ts";
import type { Db } from "../db/client.ts";
import { pushSubscriptions } from "../db/schema.ts";
import type { RateLimiter } from "../guards/ratelimit.ts";
import { HttpError } from "../http/http-error.ts";
import { boardWriteLimit, parseRequest } from "../tasks/goals-router.ts";
import type { Push } from "./push.ts";

export interface PushRouterOptions {
  db: Db;
  push: Push;
  limiter: RateLimiter;
}

/** The person's user id; the routes are behind requireHuman. */
const userIdOf = (req: express.Request): string => {
  const actor = actorOf(req);
  if (actor.kind !== "human") {
    throw new HttpError(403, "humans_only", "Only a person can do this.");
  }
  return actor.user_id;
};

export function pushRouter({ db, push, limiter }: PushRouterOptions): Router {
  const router = express.Router();
  const limit = boardWriteLimit(limiter);

  router.get("/key", requireHuman, (_req, res) => {
    res.status(200).json({ public_key: push.publicKey });
  });

  router.post("/subscribe", requireHuman, limit, async (req, res) => {
    const body = parseRequest(PushSubscribeRequestSchema, req.body);
    if (!push.publicKey) {
      throw new HttpError(503, "push_off", "Notifications are not set up yet.");
    }
    const userId = userIdOf(req);
    // One browser, one row: subscribing again (or as another person) takes it over.
    await db
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dh: body.keys.p256dh, auth: body.keys.auth },
      });
    res.status(201).json({ subscribed: true });
  });

  router.post("/unsubscribe", requireHuman, limit, async (req, res) => {
    const body = parseRequest(PushUnsubscribeRequestSchema, req.body);
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, body.endpoint),
          eq(pushSubscriptions.userId, userIdOf(req)),
        ),
      );
    res.status(200).json({ subscribed: false });
  });

  return router;
}
