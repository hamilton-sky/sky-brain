// Check order step 3 (cloud-task-board spec.md): the one table of method and path to verb, for
// every route of spec.md Routes, applied to device and run tokens before any router. It fails
// closed: a route not in the table (brain-core's entries routes, the human-only routes, the
// devices routes) refuses every device and run token.
import type { Verb } from "@sky-brain/shared/run-tokens";
import type { RequestHandler } from "express";
import { runContextOf } from "../actor/run-context.ts";
import { HttpError } from "../http/http-error.ts";

/** `mint` is the device token's one route; a run token never has it. */
export type RouteVerb = Verb | "mint";

/** Paths are below `/api/v1`; `:id` stands for exactly one non-empty path segment. */
const TABLE: readonly (readonly [string, string, RouteVerb])[] = [
  ["POST", "/run-tokens", "mint"],
  ["POST", "/goals", "plan"],
  ["GET", "/goals", "read"],
  ["GET", "/goals/:id", "read"],
  ["POST", "/goals/:id/tasks", "plan"],
  ["GET", "/tasks/ready", "read"],
  ["GET", "/tasks/:id", "read"],
  ["POST", "/tasks/:id/claim", "claim"],
  ["POST", "/tasks/:id/renew", "claim"],
  ["POST", "/tasks/:id/release", "claim"],
  ["POST", "/tasks/:id/done", "report"],
  ["POST", "/tasks/:id/fail", "report"],
];

const segments = (path: string) => path.split("/").slice(1);

const PATTERNS = TABLE.map(
  ([method, path, verb]) => [method, segments(path), verb] as const,
);

function matches(pattern: readonly string[], path: readonly string[]): boolean {
  return (
    pattern.length === path.length &&
    pattern.every((part, i) => {
      const got = path[i]!;
      // Express matches routes ignoring case; a literal compared the same way can only make a
      // listed route match, never an unlisted one.
      return part === ":id" ? got !== "" : part === got.toLowerCase();
    })
  );
}

/** The verb a method and path below `/api/v1` needs; undefined when it is not in the table. */
export function verbFor(method: string, path: string): RouteVerb | undefined {
  // Express routes are not strict: `/goals/` reaches the `/goals` route.
  const trimmed = path.length > 1 ? path.replace(/\/$/, "") : path;
  const parts = segments(trimmed);
  for (const [m, pattern, verb] of PATTERNS) {
    if (m === method && matches(pattern, parts)) return verb;
  }
  return undefined;
}

/** Mounted on `/api/v1` right after the body parser. People and other agents pass untouched. */
export function verbMiddleware(): RequestHandler {
  return (req, _res, next) => {
    const context = runContextOf(req);
    if (context) {
      const verb = verbFor(req.method, req.path);
      const allowed =
        verb !== undefined &&
        (context.kind === "device"
          ? verb === "mint"
          : verb !== "mint" && context.verbs.includes(verb));
      if (!allowed) {
        throw new HttpError(
          403,
          "verb_not_allowed",
          context.kind === "device"
            ? "A device token can only mint run tokens."
            : "This run token's verbs do not cover this route.",
        );
      }
    }
    next();
  };
}
