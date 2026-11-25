// Request checks every write route shares (cloud-task-board spec.md Check order): the write
// rate limit (step 5), request shape and size caps (step 6), path ids and the writer role (step 8).
import type { Role } from "@sky-brain/shared/enums";
import { IdSchema } from "@sky-brain/shared/scope";
import { tooLargeField } from "@sky-brain/shared/tasks";
import type { Request, RequestHandler } from "express";
import type { z } from "zod";
import { actorKey } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { runContextOf } from "../actor/run-context.ts";
import type { RateLimiter } from "../guards/ratelimit.ts";
import { effectiveRole } from "../run-tokens/run-scope.ts";
import { HttpError } from "./http-error.ts";
import { validate } from "./validate.ts";

/**
 * Check order step 5 for a board write: one bucket per actor and device (`createApp` makes one
 * limiter for every board write); 429 `rate_limited` with `Retry-After`.
 */
export function boardWriteLimit(limiter: RateLimiter): RequestHandler {
  return (req, res, next) => {
    const device = runContextOf(req)?.deviceId ?? "none";
    const taken = limiter.take(`${actorKey(actorOf(req))}|device:${device}`);
    if (!taken.ok) {
      res.set("Retry-After", String(taken.retryAfterSeconds));
      throw new HttpError(429, "rate_limited", "Too many writes; wait.");
    }
    next();
  };
}

/** Check order step 6: an over-cap value is 413 `too_large` with `field`, else 400. */
export function parseRequest<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const field = tooLargeField(result.error);
    if (field !== null) {
      throw new HttpError(413, "too_large", "A value is over its size cap.", {
        field,
      });
    }
  }
  return validate(schema, value);
}

/** A path `:id` that is not a uuid is 400 `invalid_request`. */
export function pathId(req: Request): string {
  return validate(IdSchema, req.params.id);
}

/** Check order step 8: owners and editors write; a run token's role caps the member's. */
export function assertWriter(req: Request, memberRole: Role): void {
  const role = effectiveRole(req, memberRole);
  if (role !== "owner" && role !== "editor") {
    throw new HttpError(403, "role_cannot_write", "A viewer cannot write.");
  }
}
