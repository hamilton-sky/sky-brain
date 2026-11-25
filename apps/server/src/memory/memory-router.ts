// `/api/v1/memories` and `/api/v1/entries` (BUILD-PLAN step 1). Check order: actor, body and
// verb (app; run tokens have no verb for these routes, so they are refused); humans only
// (create memory, revise, approve, reject); the write rate limit; request shape and size caps;
// target and membership (404); role and layer (403); state (409); secrets (422); quarantine.
import type { Actor } from "@sky-brain/shared/actor";
import {
  CommentCreateRequestSchema,
  CommentResolveRequestSchema,
} from "@sky-brain/shared/comments";
import {
  CaptureRequestSchema,
  MemoriesListQuerySchema,
  MemoryCreateRequestSchema,
  ReviseRequestSchema,
  SearchQuerySchema,
} from "@sky-brain/shared/memory";
import express, { type Router } from "express";
import { auditActor } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { requireHuman } from "../actor/require-human.ts";
import { writeAudit } from "../db/audit.ts";
import type { Db } from "../db/client.ts";
import { memories } from "../db/schema.ts";
import type { RateLimiter } from "../guards/ratelimit.ts";
import { HttpError } from "../http/http-error.ts";
import { validate } from "../http/validate.ts";
import { IdSchema } from "@sky-brain/shared/scope";
import {
  boardWriteLimit,
  parseRequest,
  pathId,
} from "../http/request-checks.ts";
import {
  captureEntry,
  entryVersionsOf,
  findEntry,
  reviseEntry,
  searchEntries,
  setTrust,
} from "./entries-service.ts";
import {
  addComment,
  commentsOf,
  deleteComment,
  setResolved,
} from "./comments.ts";
import {
  listMemories,
  memoryWire,
  ownWorkspace,
  workspaceRoles,
} from "./memories.ts";
import { entryWire, versionWire } from "./wire.ts";

export interface MemoryRouterOptions {
  db: Db;
  now: () => Date;
  limiter: RateLimiter;
}

function human(actor: Actor): Actor & { kind: "human" } {
  if (actor.kind !== "human") {
    throw new HttpError(403, "humans_only", "Only a person can do this.");
  }
  return actor;
}

export function memoriesRouter({
  db,
  now,
  limiter,
}: MemoryRouterOptions): Router {
  const limit = boardWriteLimit(limiter);
  const router = express.Router();

  router.get("/", async (req, res) => {
    const query = validate(MemoriesListQuerySchema, req.query);
    const rows = await listMemories(db, actorOf(req), query.workspace_id);
    res.status(200).json({ memories: rows.map(memoryWire) });
  });

  router.post("/", requireHuman, limit, async (req, res) => {
    const body = parseRequest(MemoryCreateRequestSchema, req.body);
    const actor = actorOf(req);
    const workspaceId = body.workspace_id ?? (await ownWorkspace(db, actor));
    const role = (await workspaceRoles(db, actor, workspaceId)).get(
      workspaceId,
    )!;
    if (role !== "owner" && role !== "editor") {
      throw new HttpError(403, "role_cannot_write", "A viewer cannot write.");
    }
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(memories)
        .values({
          workspaceId,
          layer: body.layer,
          name: body.name,
          createdAt: now(),
        })
        .returning();
      const who = auditActor(actor);
      await writeAudit(tx, {
        workspaceId,
        actor: who.actor,
        action: "memory.create",
        targetId: created!.id,
        details: { layer: body.layer },
      });
      return created!;
    });
    res.status(201).json({ memory: memoryWire(row) });
  });

  return router;
}

export function entriesRouter({
  db,
  now,
  limiter,
}: MemoryRouterOptions): Router {
  const limit = boardWriteLimit(limiter);
  const router = express.Router();

  router.post("/", limit, async (req, res) => {
    const body = parseRequest(CaptureRequestSchema, req.body);
    const row = await captureEntry(db, actorOf(req), body, now());
    res.status(201).json({ entry: entryWire(row, true) });
  });

  router.get("/", async (req, res) => {
    const query = validate(SearchQuerySchema, req.query);
    const hits = await searchEntries(db, actorOf(req), query, now());
    res.status(200).json({
      entries: hits.map((h) => ({
        ...entryWire(h.entry, false),
        rank: h.rank,
      })),
    });
  });

  router.get("/:id", async (req, res) => {
    const { entry } = await findEntry(db, actorOf(req), pathId(req));
    const versions = await entryVersionsOf(db, entry.id);
    res.status(200).json({
      entry: entryWire(entry, true),
      versions: versions.map(versionWire),
      // The person's notes on the text, so the model reading it with `get` sees them too.
      comments: await commentsOf(db, entry),
    });
  });

  router.get("/:id/comments", async (req, res) => {
    const { entry } = await findEntry(db, actorOf(req), pathId(req));
    res.status(200).json({ comments: await commentsOf(db, entry) });
  });

  router.post("/:id/comments", requireHuman, limit, async (req, res) => {
    const id = pathId(req);
    const body = parseRequest(CommentCreateRequestSchema, req.body);
    const comment = await addComment(db, human(actorOf(req)), id, body, now());
    res.status(201).json({ comment });
  });

  router.post(
    "/:id/comments/:commentId/resolve",
    requireHuman,
    limit,
    async (req, res) => {
      const id = pathId(req);
      const commentId = validate(IdSchema, req.params.commentId);
      const { resolved } = parseRequest(CommentResolveRequestSchema, req.body);
      const comment = await setResolved(
        db,
        human(actorOf(req)),
        id,
        commentId,
        resolved,
        now(),
      );
      res.status(200).json({ comment });
    },
  );

  router.delete(
    "/:id/comments/:commentId",
    requireHuman,
    limit,
    async (req, res) => {
      const id = pathId(req);
      const commentId = validate(IdSchema, req.params.commentId);
      await deleteComment(db, human(actorOf(req)), id, commentId);
      res.status(204).end();
    },
  );

  router.post("/:id/versions", requireHuman, limit, async (req, res) => {
    const id = pathId(req);
    const body = parseRequest(ReviseRequestSchema, req.body);
    const row = await reviseEntry(db, human(actorOf(req)), id, body, now());
    res.status(201).json({ entry: entryWire(row, true) });
  });

  for (const [path, to] of [
    ["approve", "approved"],
    ["reject", "rejected"],
  ] as const) {
    router.post(`/:id/${path}`, requireHuman, limit, async (req, res) => {
      const row = await setTrust(db, human(actorOf(req)), pathId(req), to);
      res.status(200).json({ entry: entryWire(row, false) });
    });
  }

  return router;
}
