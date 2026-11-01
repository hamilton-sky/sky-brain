// Check order step 3: agents get 403 `humans_only` before any lookup, whatever the id.
import type { RequestHandler } from "express";
import { HttpError } from "../http/http-error.ts";
import { actorOf } from "./middleware.ts";

export const requireHuman: RequestHandler = (req, _res, next) => {
  if (actorOf(req).kind !== "human") {
    throw new HttpError(403, "humans_only", "Only a person can do this.");
  }
  next();
};
