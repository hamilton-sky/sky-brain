// The last middleware: renders every error as the JSON error shape of spec.md.
import type { ErrorRequestHandler } from "express";
import { HttpError } from "./http-error.ts";

/** The `type` body-parser gives its errors. */
function bodyParserType(err: unknown): unknown {
  return typeof err === "object" && err !== null && "type" in err
    ? err.type
    : undefined;
}

function toHttpError(err: unknown): HttpError | undefined {
  if (err instanceof HttpError) return err;
  const type = bodyParserType(err);
  if (type === "entity.parse.failed") {
    return new HttpError(400, "invalid_json", "The body is not valid JSON.");
  }
  if (type === "entity.too.large") {
    return new HttpError(413, "too_large", "The body is over 64 KB.");
  }
  return undefined;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const known = toHttpError(err);
  if (!known) {
    console.error("unhandled error", err);
    res
      .status(500)
      .json({ error: { code: "internal", message: "Internal error." } });
    return;
  }
  res.status(known.status).json({
    error: { code: known.code, message: known.message, ...known.extra },
  });
};
