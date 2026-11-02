// `POST /api/v1/run-tokens` (cloud-task-board spec.md Routes): a device token mints a run token
// for one project. Check order: actor (app), body (app), verb (app: only a device token reaches
// here), request shape, then the project and membership (404), then the role (403
// `role_too_high`). The token is returned once and only its hash is stored.
import {
  RUN_TOKEN_MAX_TTL_SECONDS,
  RunTokenMintRequestSchema,
  type RunTokenRole,
} from "@sky-brain/shared/run-tokens";
import { and, eq, isNull } from "drizzle-orm";
import express, { type Router } from "express";
import { auditActor, personOf } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { runContextOf } from "../actor/run-context.ts";
import { writeAudit } from "../db/audit.ts";
import type { Db } from "../db/client.ts";
import { devices, members, projects, runTokens } from "../db/schema.ts";
import { HttpError } from "../http/http-error.ts";
import { validate } from "../http/validate.ts";
import { hashSecretToken, newSecretToken } from "./secret-token.ts";

export interface MintRouterOptions {
  db: Db;
  now: () => Date;
}

export function mintRouter(options: MintRouterOptions): Router {
  const { db, now } = options;
  const router = express.Router();

  router.post("/", async (req, res) => {
    // The verb table already refuses run tokens here; this refuses people and other agents.
    const context = runContextOf(req);
    if (context?.kind !== "device") {
      throw new HttpError(
        403,
        "verb_not_allowed",
        "Only a device token can mint run tokens.",
      );
    }
    const body = validate(RunTokenMintRequestSchema, req.body);
    const actor = actorOf(req);

    const [scope] = await db
      .select({ workspaceId: projects.workspaceId, role: members.role })
      .from(projects)
      .innerJoin(
        members,
        and(
          eq(members.workspaceId, projects.workspaceId),
          eq(members.userId, personOf(actor)),
        ),
      )
      .where(eq(projects.id, body.project_id));
    if (!scope) throw new HttpError(404, "not_found", "No such project.");

    const memberCanWrite = scope.role === "owner" || scope.role === "editor";
    if (body.role === "editor" && !memberCanWrite) {
      throw new HttpError(
        403,
        "role_too_high",
        "A viewer can only mint viewer run tokens.",
      );
    }
    const role: RunTokenRole =
      body.role ?? (memberCanWrite ? "editor" : "viewer");
    const ttl = body.ttl_seconds ?? RUN_TOKEN_MAX_TTL_SECONDS;
    const t = now();
    const expiresAt = new Date(t.getTime() + ttl * 1000);
    const token = newSecretToken("sbr");

    const row = await db.transaction(async (tx) => {
      // A device revoked since the resolver looked mints nothing.
      const [seen] = await tx
        .update(devices)
        .set({ lastSeenAt: t })
        .where(and(eq(devices.id, context.deviceId), isNull(devices.revokedAt)))
        .returning({ id: devices.id });
      if (!seen) {
        throw new HttpError(
          401,
          "invalid_token",
          "The token is unknown, expired or revoked.",
        );
      }
      const [created] = await tx
        .insert(runTokens)
        .values({
          tokenHash: hashSecretToken(token),
          deviceId: context.deviceId,
          workspaceId: scope.workspaceId,
          projectId: body.project_id,
          role,
          verbs: body.verbs,
          expiresAt,
          createdAt: t,
        })
        .returning();
      const who = auditActor(actor);
      await writeAudit(tx, {
        workspaceId: scope.workspaceId,
        actor: who.actor,
        action: "run_token.mint",
        targetId: created!.id,
        details: {
          ...who.details,
          device_id: context.deviceId,
          project_id: body.project_id,
          verbs: body.verbs,
          role,
          ttl_seconds: ttl,
        },
      });
      return created!;
    });

    res.status(201).json({
      run_token: token,
      expires_at: row.expiresAt.toISOString(),
      workspace_id: row.workspaceId,
      project_id: row.projectId,
      role: row.role,
      verbs: row.verbs,
      device_id: row.deviceId,
    });
  });

  return router;
}
