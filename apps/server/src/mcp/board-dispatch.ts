// The MCP board tools call the board's own REST routers in process (light-my-request), with
// the actor the MCP route already verified from the bearer JWT. So every check the REST routes
// make (membership, role, humans only, run scope, secrets, quarantine, rate limit, state)
// applies to a tool call unchanged, with no second copy of that logic. This app is never
// listening: nothing outside the process can reach it, so no request can name its own actor.
import type { Actor } from "@sky-brain/shared/actor";
import express from "express";
import { inject } from "light-my-request";
import { attachVerifiedActor } from "../actor/middleware.ts";
import type { Db } from "../db/client.ts";
import type { RateLimiter } from "../guards/ratelimit.ts";
import { errorHandler } from "../http/error-handler.ts";
import { projectsRouter } from "../projects/projects-router.ts";
import { goalsRouter } from "../tasks/goals-router.ts";
import { tasksRouter } from "../tasks/tasks-router.ts";

/** Copies the methods of `obj`'s own class prototype onto `obj` itself. */
function pinOwnMethods(obj: object): void {
  const proto = Object.getPrototypeOf(obj) as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor") continue;
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (descriptor && typeof descriptor.value === "function") {
      Object.defineProperty(obj, name, { ...descriptor, enumerable: false });
    }
  }
}

export interface BoardResponse {
  status: number;
  /** The parsed JSON body, or null. */
  body: unknown;
}

export type BoardCall = (
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) => Promise<BoardResponse>;

export interface BoardDispatchOptions {
  db: Db;
  now: () => Date;
  limiter: RateLimiter;
}

/** One in-process board app; `forActor(actor)` gives a caller bound to that actor. */
export function boardDispatcher(options: BoardDispatchOptions) {
  const { db, now, limiter } = options;
  const actorOfRequest = new WeakMap<object, Actor>();
  const app = express();
  app.set("trust proxy", false);
  app.use(
    "/api/v1",
    (req, _res, next) => {
      const actor = actorOfRequest.get(req);
      if (!actor) throw new Error("board dispatch: no actor");
      attachVerifiedActor(req, actor);
      next();
    },
    express.json({ limit: "64kb" }),
  );
  app.use("/api/v1/projects", projectsRouter({ db, limiter }));
  app.use("/api/v1/goals", goalsRouter({ db, now, limiter }));
  app.use("/api/v1/tasks", tasksRouter({ db, now, limiter }));
  app.use("/api", (_req, res) => {
    res
      .status(404)
      .json({ error: { code: "not_found", message: "No such API route." } });
  });
  app.use("/api", errorHandler);

  return {
    forActor(actor: Actor): BoardCall {
      return async (method, path, body) => {
        const res = await inject(
          (req, res) => {
            actorOfRequest.set(req, actor);
            // Express swaps the prototypes of req and res for its own; keep light-my-request's
            // methods (write, end, _read, ...) as own properties so the swap cannot drop them.
            pinOwnMethods(req);
            pinOwnMethods(res);
            app(req as express.Request, res as express.Response);
          },
          {
            method,
            url: `/api/v1${path}`,
            ...(body === undefined
              ? {}
              : {
                  payload: JSON.stringify(body),
                  headers: { "content-type": "application/json" },
                }),
          },
        );
        let parsed: unknown;
        try {
          parsed = res.payload ? JSON.parse(res.payload) : null;
        } catch {
          parsed = null;
        }
        return { status: res.statusCode, body: parsed };
      };
    },
  };
}
