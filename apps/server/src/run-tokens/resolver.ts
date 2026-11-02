// Check order step 1 for device and run tokens (cloud-task-board spec.md): a bearer token with
// the `sbd_` or `sbr_` prefix is looked up by its hash and becomes the agent `device/<id>` acting
// for the device's person, with its run context beside it. An unknown, expired or revoked one is
// 401 `invalid_token` and never falls through; any other bearer token is left to the next
// resolver.
import type { Actor } from "@sky-brain/shared/actor";
import { and, eq, isNull } from "drizzle-orm";
import type { Request } from "express";
import type { ActorResolver } from "../actor/middleware.ts";
import { setRunContext } from "../actor/run-context.ts";
import type { Db } from "../db/client.ts";
import { devices, runTokens } from "../db/schema.ts";
import { HttpError } from "../http/http-error.ts";
import { hashSecretToken } from "./secret-token.ts";

const invalidToken = () =>
  new HttpError(
    401,
    "invalid_token",
    "The token is unknown, expired or revoked.",
  );

const agentOf = (deviceId: string, person: string): Actor => ({
  kind: "agent",
  agent_id: `device/${deviceId}`,
  on_behalf_of: person,
});

/** The bearer token of a request, or undefined. The scheme name is case-insensitive (HTTP). */
function bearerOf(req: Request): string | undefined {
  return /^Bearer\s+(\S+)\s*$/i.exec(req.get("authorization") ?? "")?.[1];
}

export function runTokenResolver(db: Db, now: () => Date): ActorResolver {
  return async (req) => {
    const token = bearerOf(req);
    if (token === undefined) return undefined;
    const hash = hashSecretToken(token);

    if (token.startsWith("sbd_")) {
      const [device] = await db
        .select({ id: devices.id, userId: devices.userId })
        .from(devices)
        .where(and(eq(devices.secretHash, hash), isNull(devices.revokedAt)));
      if (!device) throw invalidToken();
      setRunContext(req, {
        kind: "device",
        deviceId: device.id,
        tokenId: device.id,
        verbs: [],
      });
      return agentOf(device.id, device.userId);
    }

    if (token.startsWith("sbr_")) {
      const [row] = await db
        .select({ run: runTokens, userId: devices.userId })
        .from(runTokens)
        .innerJoin(devices, eq(devices.id, runTokens.deviceId))
        .where(and(eq(runTokens.tokenHash, hash), isNull(devices.revokedAt)));
      // Expired from exactly expires_at, by the app clock.
      if (!row || row.run.expiresAt.getTime() <= now().getTime()) {
        throw invalidToken();
      }
      setRunContext(req, {
        kind: "run",
        deviceId: row.run.deviceId,
        tokenId: row.run.id,
        workspaceId: row.run.workspaceId,
        projectId: row.run.projectId,
        role: row.run.role,
        verbs: row.run.verbs,
      });
      return agentOf(row.run.deviceId, row.userId);
    }

    return undefined;
  };
}
