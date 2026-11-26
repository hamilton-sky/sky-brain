// Comments on a document (an entry): a person marks a passage and writes a note, the way
// Pathly's editor does (`/api/v1/entries/:id/comments`). People and their agents write them (an
// agent through MCP `comment`, D45); only people resolve and delete them. An agent reads them with
// the entry (MCP `get`) so the model it serves sees the person's notes.
import { z } from "zod";

export const COMMENT_COLORS = [
  "yellow",
  "green",
  "blue",
  "purple",
  "orange",
] as const;
export type CommentColor = (typeof COMMENT_COLORS)[number];

export const COMMENT_BODY_MAX = 2000;
export const COMMENT_QUOTE_MAX = 500;
/** An entry holds at most this many comments. */
export const COMMENTS_PER_ENTRY_MAX = 200;

/** `POST /api/v1/entries/:id/comments`. */
export const CommentCreateRequestSchema = z.strictObject({
  body: z.string().trim().min(1).max(COMMENT_BODY_MAX),
  /** The passage the comment is on, as the person selected it; none for a general note. */
  quote: z.string().trim().min(1).max(COMMENT_QUOTE_MAX).optional(),
  color: z.enum(COMMENT_COLORS).default("yellow"),
});
export type CommentCreateRequest = z.infer<typeof CommentCreateRequestSchema>;

/** `POST /api/v1/entries/:id/comments/:commentId/resolve`. */
export const CommentResolveRequestSchema = z.strictObject({
  resolved: z.boolean(),
});

export interface EntryComment {
  id: string;
  entry_id: string;
  quote: string | null;
  body: string;
  color: CommentColor;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  author_kind: "human" | "agent";
  author: string;
  created_at: string;
}
