// `/api/v1/projects`: list the projects of the caller's workspaces, and (people only) create
// one. Check order: actor (app); humans only (create); the board-write rate limit; request
// shape; workspace membership (404); role (403); a taken slug (409).
import {
  ProjectCreateRequestSchema,
  ProjectsListQuerySchema,
  slugify,
  type Project,
} from "@sky-brain/shared/projects";
import { and, asc, eq } from "drizzle-orm";
import express, { type Router } from "express";
import { auditActor, personOf } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { requireHuman } from "../actor/require-human.ts";
import { writeAudit } from "../db/audit.ts";
import type { Db, DbOrTx } from "../db/client.ts";
import { members, projects } from "../db/schema.ts";
import type { RateLimiter } from "../guards/ratelimit.ts";
import { HttpError } from "../http/http-error.ts";
import { validate } from "../http/validate.ts";
import { resolveScope } from "../scope/resolve-scope.ts";
import { boardWriteLimit } from "../tasks/goals-router.ts";

type ProjectRow = typeof projects.$inferSelect;

function toWireProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    slug: row.slug,
    name: row.name,
    created_at: row.createdAt.toISOString(),
  };
}

/** Every project in the workspaces `person` belongs to, optionally one workspace only. */
async function listProjects(
  db: DbOrTx,
  person: string,
  workspaceId?: string,
): Promise<Project[]> {
  const rows = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(
      members,
      and(
        eq(members.workspaceId, projects.workspaceId),
        eq(members.userId, person),
      ),
    )
    .where(
      workspaceId === undefined
        ? undefined
        : eq(projects.workspaceId, workspaceId),
    )
    .orderBy(asc(projects.createdAt), asc(projects.id));
  return rows.map((r) => toWireProject(r.project));
}

export function projectsRouter(options: {
  db: Db;
  limiter: RateLimiter;
}): Router {
  const { db } = options;
  const router = express.Router();

  router.get("/", async (req, res) => {
    const query = validate(ProjectsListQuerySchema, req.query);
    const person = personOf(actorOf(req));
    res
      .status(200)
      .json({ projects: await listProjects(db, person, query.workspace_id) });
  });

  router.post(
    "/",
    requireHuman,
    boardWriteLimit(options.limiter),
    async (req, res) => {
      const body = validate(ProjectCreateRequestSchema, req.body);
      const actor = actorOf(req);
      const scope = await resolveScope(db, actor, {
        workspace_id: body.workspace_id,
      });
      if (scope.role !== "owner" && scope.role !== "editor") {
        throw new HttpError(403, "role_cannot_write", "A viewer cannot write.");
      }
      const slug = body.slug ?? slugify(body.name);
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(projects)
          .values({ workspaceId: scope.workspaceId, slug, name: body.name })
          .onConflictDoNothing()
          .returning();
        if (!created) {
          throw new HttpError(
            409,
            "slug_taken",
            "A project with that slug already exists in this workspace.",
            { field: "slug" },
          );
        }
        const who = auditActor(actor);
        await writeAudit(tx, {
          workspaceId: scope.workspaceId,
          actor: who.actor,
          action: "project.create",
          targetId: created.id,
          details: { ...who.details },
        });
        return created;
      });
      res.status(201).json({ project: toWireProject(row) });
    },
  );

  return router;
}
