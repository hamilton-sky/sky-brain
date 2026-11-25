// `GET /api/v1/me`: who the caller is and the workspaces they belong to, for the web page.
// The same answer as the MCP `whoami` tool; identity comes from the session or token only.
import express, { type Router } from "express";
import { actorOf } from "@sky-brain/kernel/actor/middleware";
import type { Db } from "@sky-brain/db/client";
import { HttpError } from "@sky-brain/kernel/http/http-error";
import { whoami } from "../mcp/whoami.ts";

export function meRouter(options: { db: Db }): Router {
  const router = express.Router();
  router.get("/", async (req, res) => {
    const actor = actorOf(req);
    let me;
    try {
      me = await whoami(options.db, actor);
    } catch {
      throw new HttpError(404, "not_found", "No such user.");
    }
    res.status(200).json({ kind: actor.kind, ...me });
  });
  return router;
}
