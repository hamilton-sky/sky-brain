// Request shape (Check order step 5): a zod failure is 400 `invalid_request`.
import type { z } from "zod";
import { HttpError } from "./http-error.ts";

export function validate<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path.map(String).join(".");
  throw new HttpError(
    400,
    "invalid_request",
    issue?.message ?? "The request is not valid.",
    field ? { field } : {},
  );
}
