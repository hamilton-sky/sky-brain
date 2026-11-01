// Scope is given as exactly one id; the server derives the rest (spec.md Decisions).
import { z } from "zod";

/** A path `:id` (an entry or a workspace id). */
export const IdSchema = z.uuid();

// Strict objects, so a second id makes every branch fail.
export const ScopeRefSchema = z.union([
  z.strictObject({ workspace_id: IdSchema }),
  z.strictObject({ project_id: IdSchema }),
  z.strictObject({ feature_id: IdSchema }),
]);
export type ScopeRef = z.infer<typeof ScopeRefSchema>;
