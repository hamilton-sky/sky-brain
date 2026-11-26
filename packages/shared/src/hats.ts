// Hats (D30, D42): self-aspects of one brain (Parent, Engineer, Friend). A person makes them
// and binds a connected app to one; a hat only narrows what an agent sees (hard rule 2: the
// binding lives on the server, so an agent never claims a hat for itself).
import { z } from "zod";
import { IdSchema } from "./scope.ts";

/** Lowercase, short, and safe in a URL; matches the database check `hats_slug_format`. */
export const HatSlugSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,39}$/,
    "Use 1 to 40 lowercase letters, digits or dashes.",
  );

export const HatCreateRequestSchema = z.strictObject({
  slug: HatSlugSchema,
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(600).default(""),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export type HatCreateRequest = z.infer<typeof HatCreateRequestSchema>;

/** Bind a connected app to a hat, or (`hat_id: null`) back to no hat. */
export const HatBindRequestSchema = z.strictObject({
  client_id: z.string().min(1).max(2048),
  hat_id: IdSchema.nullable(),
});
export type HatBindRequest = z.infer<typeof HatBindRequestSchema>;

export interface Hat {
  id: string;
  slug: string;
  name: string;
  description: string;
  color: string | null;
  created_at: string;
}
