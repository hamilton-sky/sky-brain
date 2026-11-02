// The anonymous RFC 8628 device-flow routes (spec.md Stories -> A person logs a machine in once),
// mounted at /api/device before the /api/v1 actor middleware. Errors answer as RFC 8628 does:
// 400 {"error": "<code>"}, not the {"error": {code, message}} shape of /api/v1.
import {
  DEVICE_CODE_GRANT_TYPE,
  DeviceCodeRequestSchema,
  DeviceTokenRequestSchema,
} from "@sky-brain/shared/devices";
import { and, eq, isNull, sql } from "drizzle-orm";
import express, {
  type ErrorRequestHandler,
  type Response,
  type Router,
} from "express";
import { randomBytes } from "node:crypto";
import type { Db } from "../db/client.ts";
import { deviceCodes, devices } from "../db/schema.ts";
import { hashSecretToken, newSecretToken } from "../run-tokens/secret-token.ts";
import { formatUserCode, newUserCode } from "./user-code.ts";

export const DEVICE_CODE_TTL_SECONDS = 900;
export const POLL_INTERVAL_SECONDS = 5;
/** Where a person approves a code. The page itself comes in round two (R2-01). */
const VERIFICATION_PATH = "/devices/approve";
/** A fresh user code collides with a pending one about once in 2.5e10; retry a few times. */
const USER_CODE_ATTEMPTS = 5;

export interface DeviceFlowOptions {
  db: Db;
  now: () => Date;
}

type FlowError =
  | "invalid_request"
  | "unsupported_grant_type"
  | "authorization_pending"
  | "slow_down"
  | "expired_token"
  | "invalid_grant";

type PollResult =
  { error: FlowError } | { deviceToken: string; deviceId: string };

function flowError(res: Response, error: FlowError, status = 400): void {
  res.status(status).json({ error });
}

/** Body-parser errors (broken JSON, over 64 KB) in the RFC 8628 shape; anything else goes on. */
const flowBodyErrors: ErrorRequestHandler = (err, _req, res, next) => {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? (err as { status: unknown }).status
      : undefined;
  const expose =
    typeof err === "object" && err !== null && "expose" in err
      ? (err as { expose: unknown }).expose
      : false;
  if (
    !res.headersSent &&
    expose === true &&
    typeof status === "number" &&
    status >= 400 &&
    status < 500
  ) {
    flowError(res, "invalid_request", status === 413 ? 413 : 400);
    return;
  }
  next(err);
};

export function deviceFlowRouter(options: DeviceFlowOptions): Router {
  const { db, now } = options;
  const router = express.Router();
  router.use(express.json({ limit: "64kb" }));

  router.post("/code", async (req, res) => {
    const parsed = DeviceCodeRequestSchema.safeParse(req.body);
    if (!parsed.success) return flowError(res, "invalid_request");
    const deviceCode = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      now().getTime() + DEVICE_CODE_TTL_SECONDS * 1000,
    );
    for (let attempt = 0; attempt < USER_CODE_ATTEMPTS; attempt += 1) {
      const userCode = newUserCode();
      const inserted = await db
        .insert(deviceCodes)
        .values({
          deviceCodeHash: hashSecretToken(deviceCode),
          userCode,
          clientName: parsed.data.client_name,
          expiresAt,
          intervalSeconds: POLL_INTERVAL_SECONDS,
          createdAt: now(),
        })
        .onConflictDoNothing({
          target: deviceCodes.userCode,
          where: sql`${deviceCodes.deviceId} is null`,
        })
        .returning({ id: deviceCodes.id });
      if (inserted.length === 1) {
        res.status(200).json({
          device_code: deviceCode,
          user_code: formatUserCode(userCode),
          verification_uri: `${req.protocol}://${req.get("host")}${VERIFICATION_PATH}`,
          expires_in: DEVICE_CODE_TTL_SECONDS,
          interval: POLL_INTERVAL_SECONDS,
        });
        return;
      }
    }
    throw new Error(
      `device flow: no free user code after ${USER_CODE_ATTEMPTS} attempts`,
    );
  });

  router.post("/token", async (req, res) => {
    const parsed = DeviceTokenRequestSchema.safeParse(req.body);
    if (!parsed.success) return flowError(res, "invalid_request");
    if (parsed.data.grant_type !== DEVICE_CODE_GRANT_TYPE) {
      return flowError(res, "unsupported_grant_type");
    }
    const t = now();
    const result = await db.transaction(async (tx): Promise<PollResult> => {
      const [row] = await tx
        .select()
        .from(deviceCodes)
        .where(
          eq(
            deviceCodes.deviceCodeHash,
            hashSecretToken(parsed.data.device_code),
          ),
        )
        .for("update");
      if (!row || row.issuedAt) return { error: "invalid_grant" } as const;
      if (row.expiresAt.getTime() <= t.getTime()) {
        return { error: "expired_token" } as const;
      }
      const last = row.lastPolledAt;
      await tx
        .update(deviceCodes)
        .set({ lastPolledAt: t })
        .where(eq(deviceCodes.id, row.id));
      if (last && t.getTime() - last.getTime() < row.intervalSeconds * 1000) {
        return { error: "slow_down" } as const;
      }
      if (!row.deviceId) return { error: "authorization_pending" } as const;
      const issued = await tx
        .update(deviceCodes)
        .set({ issuedAt: t })
        .where(and(eq(deviceCodes.id, row.id), isNull(deviceCodes.issuedAt)))
        .returning({ id: deviceCodes.id });
      if (issued.length !== 1) return { error: "invalid_grant" } as const;
      const deviceToken = newSecretToken("sbd");
      await tx
        .update(devices)
        .set({ secretHash: hashSecretToken(deviceToken) })
        .where(eq(devices.id, row.deviceId));
      return { deviceToken, deviceId: row.deviceId } as const;
    });
    if ("error" in result) return flowError(res, result.error);
    res
      .status(200)
      .json({ device_token: result.deviceToken, device_id: result.deviceId });
  });

  router.use(flowBodyErrors);
  return router;
}
