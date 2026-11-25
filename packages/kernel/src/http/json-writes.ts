// A cookie-session write must be JSON: a cross-site HTML form can send only form or text
// bodies, and a JSON body from another origin needs a CORS preflight this app never grants.
// Requests that carry an `Authorization` header are not cookie-authenticated and pass.
import type { RequestHandler } from "express";
import { HttpError } from "./http-error.ts";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireJsonWrites(): RequestHandler {
  return (req, _res, next) => {
    if (
      !SAFE.has(req.method) &&
      req.get("authorization") === undefined &&
      !req.is("application/json")
    ) {
      throw new HttpError(
        415,
        "json_required",
        "A write from a browser session must send Content-Type: application/json.",
      );
    }
    next();
  };
}
