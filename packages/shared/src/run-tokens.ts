// Run tokens (cloud-task-board spec.md Interfaces): the one definition of the verbs, and the
// strict mint request. The server's verb table, the mint route and the task routes import these.
import { z } from "zod";
import { IdSchema } from "./scope.ts";

export const VERBS = ["read", "plan", "claim", "report"] as const;
export type Verb = (typeof VERBS)[number];
export const verbSchema = z.enum(VERBS);

/** A run token is never an owner: at most `editor`. */
export const RUN_TOKEN_ROLES = ["editor", "viewer"] as const;
export type RunTokenRole = (typeof RUN_TOKEN_ROLES)[number];

export const RUN_TOKEN_MIN_TTL_SECONDS = 60;
export const RUN_TOKEN_MAX_TTL_SECONDS = 1800;

/** `POST /api/v1/run-tokens`. Strict: the device and workspace come from the token and project. */
export const RunTokenMintRequestSchema = z.strictObject({
  project_id: IdSchema,
  verbs: z
    .array(verbSchema)
    .min(1)
    .max(VERBS.length)
    .refine((verbs) => new Set(verbs).size === verbs.length, {
      message: "verbs must not repeat.",
    }),
  role: z.enum(RUN_TOKEN_ROLES).optional(),
  ttl_seconds: z
    .int()
    .min(RUN_TOKEN_MIN_TTL_SECONDS)
    .max(RUN_TOKEN_MAX_TTL_SECONDS)
    .optional(),
});
export type RunTokenMintRequest = z.infer<typeof RunTokenMintRequestSchema>;
