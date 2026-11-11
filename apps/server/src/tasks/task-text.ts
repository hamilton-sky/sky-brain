// The pinned-text hash (cloud-task-board spec.md Decisions: approval pins task text by a hash
// computed in the app, since PGlite refuses it as a generated column). Every task insert and
// update writes `text_hash` with it, and approve copies it to `approved_hash`.
import { createHash } from "node:crypto";

export interface TaskText {
  title: string;
  body: string;
  /** Null (touches everything) hashes differently from `[]`. */
  files: readonly string[] | null;
  context_refs: readonly string[];
}

/**
 * SHA-256 hex over the canonical JSON `[title, body, files, context_refs]`: a fixed-order array,
 * so no key order is involved, and JSON quoting keeps text from moving between fields.
 */
export function taskTextHash(text: TaskText): string {
  const canonical = JSON.stringify([
    text.title,
    text.body,
    text.files,
    text.context_refs,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
