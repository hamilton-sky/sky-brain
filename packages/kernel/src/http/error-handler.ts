// The last middleware: renders every error as the JSON error shape of spec.md.
import type { ErrorRequestHandler } from "express";
import { HttpError } from "./http-error.ts";

/** The `type` body-parser gives its errors. */
function bodyParserType(err: unknown): unknown {
  return typeof err === "object" && err !== null && "type" in err
    ? err.type
    : undefined;
}

function isClientBodyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { status, statusCode, expose } = err as Record<string, unknown>;
  const code = typeof status === "number" ? status : statusCode;
  return (
    expose === true && typeof code === "number" && code >= 400 && code < 500
  );
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
  // Any other body the client sent wrong (an unsupported charset or encoding, a corrupt gzip
  // stream): body-parser marks it a 4xx with `expose`, so it is the client's fault, not ours.
  if (isClientBodyError(err)) {
    return new HttpError(400, "invalid_json", "The body could not be read.");
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
