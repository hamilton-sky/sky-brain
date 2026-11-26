// `GET /api/v1/book` and `GET /api/v1/book/:id` (D46): the brain book that agents read with the
// MCP `book` tool, for the person's own Book page. The same text, and "Your brain now" is filled
// through the same in-process routes as the caller, so it shows only the caller's own workspaces
// (hard rule 4). Read-only; run and device tokens cannot reach it (the verbs table fails closed).
import { Router, type Request } from "express";
import { actorOf } from "@sky-brain/kernel/actor/middleware";
import { HttpError } from "@sky-brain/kernel/http/http-error";
import type { boardDispatcher } from "../mcp/board-dispatch.ts";
import { BOOK_CHAPTERS } from "../mcp/book-chapters.ts";
import { readBook } from "../mcp/book-tool.ts";

/** Chapter ids in book order, with the title from each chapter's first heading. */
const BOOK_INDEX = Object.entries(BOOK_CHAPTERS).map(([id, text]) => ({
  id,
  title:
    id === "contents"
      ? "Contents"
      : (/^# (?:\d+\.\s*)?(.+)$/m.exec(text)?.[1] ?? id).trim(),
}));

export function bookRouter(board: ReturnType<typeof boardDispatcher>): Router {
  const router = Router();
  const answer = async (req: Request, id?: string) => {
    if (id !== undefined && !(id in BOOK_CHAPTERS)) {
      throw new HttpError(404, "not_found", "No such chapter.");
    }
    const actor = actorOf(req);
    const markdown = await readBook(board.forActor(actor), actor, id);
    return { id: id ?? "contents", markdown, chapters: BOOK_INDEX };
  };
  router.get("/", async (req, res) => {
    res.json(await answer(req));
  });
  router.get("/:id", async (req, res) => {
    res.json(await answer(req, req.params.id));
  });
  return router;
}
