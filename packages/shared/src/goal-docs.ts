// Documents attached to a goal (`/api/v1/goals/:id/documents`): an entry (markdown with the
// writer's summary) linked to a goal, so the board shows its summary and the person reads it.
import { z } from "zod";
import type { KnowledgeKind, MemoryLayer, TrustLevel } from "./memory.ts";
import { IdSchema } from "./scope.ts";

/** A goal holds at most this many documents. */
export const GOAL_DOCUMENTS_MAX = 20;

/** `POST /api/v1/goals/:id/documents`. */
export const AttachDocumentRequestSchema = z.strictObject({
  entry_id: IdSchema,
});
export type AttachDocumentRequest = z.infer<typeof AttachDocumentRequestSchema>;

/** One attached document as the goal shows it: the summary, never the body. */
export interface GoalDocument {
  entry_id: string;
  memory_id: string;
  layer: MemoryLayer;
  kind: KnowledgeKind;
  trust: TrustLevel;
  title: string;
  summary: string;
  version: number;
  author_kind: "human" | "agent";
  author: string;
  quarantined_because: string | null;
  updated_at: string;
  attached_by: string;
  attached_at: string;
}
