// The human devices routes under /api/v1/devices (spec.md Routes): approve a device code, list
// one's devices, revoke one. Check order: actor (app), body (app), humans only, rate limit
// (approve), request shape, then the target.
import { IdSchema } from "@sky-brain/shared/scope";
import { DeviceApproveRequestSchema } from "@sky-brain/shared/devices";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import express, { type RequestHandler, type Router } from "express";
import { auditActor, personOf } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { requireHuman } from "../actor/require-human.ts";
import { writeAudit } from "../db/audit.ts";
import type { Db } from "../db/client.ts";
import { deviceCodes, devices } from "../db/schema.ts";
import { HttpError } from "../http/http-error.ts";
import { validate } from "../http/validate.ts";
import { normalizeUserCode } from "./user-code.ts";
import { createWindowLimiter } from "./window-limiter.ts";

// Devices belong to a person, not a workspace, but audit_log.workspace_id is NOT NULL: device
// audit rows use the nil uuid as their workspace (the column has no foreign key).
const NO_WORKSPACE = "00000000-0000-0000-0000-000000000000";

/** Approve: 5 per 15 minutes per person (spec.md Check order step 5), a fixed window. */
const APPROVES = 5;
const APPROVE_WINDOW_SECONDS = 15 * 60;

export interface DevicesRouterOptions {
  db: Db;
  now: () => Date;
}

type DeviceRow = typeof devices.$inferSelect;

function toWire(d: DeviceRow) {
  return {
    id: d.id,
    name: d.name,
    created_at: d.createdAt.toISOString(),
    last_seen_at: d.lastSeenAt?.toISOString() ?? null,
    revoked_at: d.revokedAt?.toISOString() ?? null,
  };
}

const notFound = () =>
  new HttpError(404, "not_found", "No such device or user code.");

export function devicesRouter(options: DevicesRouterOptions): Router {
  const { db, now } = options;
  const router = express.Router();
  const limiter = createWindowLimiter({
    limit: APPROVES,
    windowMs: APPROVE_WINDOW_SECONDS * 1000,
    now: () => now().getTime(),
  });

  const approveLimit: RequestHandler = (req, res, next) => {
    const taken = limiter.take(personOf(actorOf(req)));
    if (!taken.ok) {
      res.set("Retry-After", String(taken.retryAfterSeconds));
      throw new HttpError(429, "rate_limited", "Too many approvals; wait.");
    }
    next();
  };

  router.use(requireHuman);

  router.post("/approve", approveLimit, async (req, res) => {
    const body = validate(DeviceApproveRequestSchema, req.body);
    const actor = actorOf(req);
    const person = personOf(actor);
    const userCode = normalizeUserCode(body.user_code);
    if (!userCode) throw notFound();
    const t = now();
    const device = await db.transaction(async (tx) => {
      const [code] = await tx
        .select({ id: deviceCodes.id })
        .from(deviceCodes)
        .where(
          and(
            eq(deviceCodes.userCode, userCode),
            isNull(deviceCodes.deviceId),
            gt(deviceCodes.expiresAt, t),
          ),
        )
        .for("update");
      if (!code) throw notFound();
      const [created] = await tx
        .insert(devices)
        .values({ userId: person, name: body.name, createdAt: t })
        .returning();
      await tx
        .update(deviceCodes)
        .set({ deviceId: created!.id, approvedBy: person })
        .where(eq(deviceCodes.id, code.id));
      const who = auditActor(actor);
      await writeAudit(tx, {
        workspaceId: NO_WORKSPACE,
        actor: who.actor,
        action: "device.approve",
        targetId: created!.id,
        details: { ...who.details, device_code_id: code.id },
      });
      return created!;
    });
    res.status(200).json({ device: toWire(device) });
  });

  router.get("/", async (req, res) => {
    const rows = await db
      .select()
      .from(devices)
      .where(eq(devices.userId, personOf(actorOf(req))))
      .orderBy(asc(devices.createdAt), asc(devices.id));
    res.status(200).json({ devices: rows.map(toWire) });
  });

  router.post("/:id/revoke", async (req, res) => {
    const id = validate(IdSchema, req.params.id);
    const actor = actorOf(req);
    const t = now();
    const device = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, id), eq(devices.userId, personOf(actor))))
        .for("update");
      if (!row) throw notFound();
      if (row.revokedAt) return row;
      const [revoked] = await tx
        .update(devices)
        .set({ revokedAt: t })
        .where(eq(devices.id, id))
        .returning();
      const who = auditActor(actor);
      await writeAudit(tx, {
        workspaceId: NO_WORKSPACE,
        actor: who.actor,
        action: "device.revoke",
        targetId: id,
        details: who.details,
      });
      return revoked!;
    });
    res.status(200).json({ device: toWire(device) });
  });

  return router;
}
