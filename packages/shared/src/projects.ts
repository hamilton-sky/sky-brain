// Projects and the signed-in person, as the board's web page and MCP tools see them.
import { z } from "zod";
import { IdSchema } from "./scope.ts";

export const PROJECT_CAPS = { name: 120, slug: 60 } as const;

/** Lowercase letters, digits and single dashes, starting and ending with a letter or digit. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `GET /api/v1/projects`; without `workspace_id`, every workspace the person belongs to. */
export const ProjectsListQuerySchema = z.strictObject({
  workspace_id: IdSchema.optional(),
});

/** `POST /api/v1/projects` (people only). The slug defaults to one made from the name. */
export const ProjectCreateRequestSchema = z.strictObject({
  workspace_id: IdSchema,
  name: z.string().trim().min(1).max(PROJECT_CAPS.name),
  slug: z.string().max(PROJECT_CAPS.slug).regex(SLUG_PATTERN).optional(),
});
export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequestSchema>;

export interface Project {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  created_at: string;
}

/** A slug from a name: lowercase ASCII words joined by dashes; `project` when none is left. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PROJECT_CAPS.slug)
    .replace(/-+$/g, "");
  return slug === "" ? "project" : slug;
}
