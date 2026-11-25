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
import { auditActor, personOf } from "@sky-brain/kernel/actor/keys";
import { actorOf } from "@sky-brain/kernel/actor/middleware";
import { requireHuman } from "@sky-brain/kernel/actor/require-human";
import { writeAudit } from "@sky-brain/db/audit";
import type { Db, DbOrTx } from "@sky-brain/db/client";
import { members, projects } from "@sky-brain/db/schema";
import type { RateLimiter } from "@sky-brain/kernel/guards/ratelimit";
import { HttpError } from "@sky-brain/kernel/http/http-error";
import { validate } from "@sky-brain/kernel/http/validate";
import { resolveScope } from "@sky-brain/kernel/scope/resolve-scope";
import { boardWriteLimit } from "@sky-brain/kernel/http/request-checks";

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
