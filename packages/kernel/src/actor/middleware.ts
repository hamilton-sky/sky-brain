// Check order step 1: every /api/v1 request needs an actor (spec.md Interfaces).
import { ActorSchema, type Actor } from "@sky-brain/shared/actor";
import type { Request, RequestHandler } from "express";
import { HttpError } from "../http/http-error.ts";

/** Finds the actor of a request from its token or session; undefined when there is none. */
export type ActorResolver = (
  req: Request,
) => Actor | undefined | Promise<Actor | undefined>;

export interface ActorOptions {
  resolveActor: ActorResolver;
  /** Honour `X-Dev-Actor`. Only `NODE_ENV=development` turns it on (D15). */
  devActorHeader: boolean;
}

const actors = new WeakMap<Request, Actor>();

/** Host names (without the port) a request carrying `X-Dev-Actor` may be addressed to. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** The actor the middleware attached. Throws if a route runs without the middleware. */
export function actorOf(req: Request): Actor {
  const actor = actors.get(req);
  if (!actor) throw new Error("actorOf: no actor middleware ran");
  return actor;
}

/**
 * Attach an actor that was already verified elsewhere: the MCP route's bearer JWT, for the
 * board tools' in-process calls (mcp/board-dispatch.ts). Never call it with request input.
 */
export function attachVerifiedActor(req: Request, actor: Actor): void {
  actors.set(req, actor);
}

function parseDevActor(raw: string): Actor {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = undefined;
  }
  const parsed = ActorSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(
      401,
      "invalid_dev_actor",
      "X-Dev-Actor is not a valid actor.",
    );
  }
  return parsed.data;
}

export function actorMiddleware(options: ActorOptions): RequestHandler {
  return async (req, _res, next) => {
    const devHeader = req.get("x-dev-actor");
    let actor: Actor | undefined;
    if (devHeader !== undefined) {
      if (!options.devActorHeader) {
        throw new HttpError(
          401,
          "dev_actor_disabled",
          "X-Dev-Actor is only honoured when NODE_ENV is development.",
        );
      }
      // 127.0.0.1 alone does not stop DNS rebinding: a page on another name that resolves
      // here is same-origin to the browser, so the Host must name this machine too (D15).
      if (!LOOPBACK_HOSTS.has(req.hostname)) {
        throw new HttpError(
          401,
          "dev_actor_disabled",
          "X-Dev-Actor is only honoured for requests addressed to localhost.",
        );
      }
      actor = parseDevActor(devHeader);
    } else {
      actor = await options.resolveActor(req);
    }
    if (!actor) {
      throw new HttpError(401, "unauthenticated", "No actor on this request.");
    }
    actors.set(req, actor);
    next();
  };
}
