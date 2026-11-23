// Agent profiles (docs/vision/AGENTS.md, D25 part 1: identity). A person names the roles their
// agents play (po, doer, reviewer...) and binds each connected app to one. The binding lives on
// the server, so an agent never claims a role for itself (hard rule 2).
import { z } from "zod";
import { IdSchema } from "./scope.ts";

export const AGENT_KINDS = ["worker", "steward"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** Short, lowercase, and part of the agent id (`mcp/<client host>/<slug>`). */
export const AgentSlugSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{0,23}$/,
    "Use 1 to 24 lowercase letters, digits or dashes, starting with a letter.",
  );

export const AgentProfileCreateRequestSchema = z.strictObject({
  slug: AgentSlugSchema,
  display_name: z.string().trim().min(1).max(60),
  kind: z.enum(AGENT_KINDS).default("worker"),
});
export type AgentProfileCreateRequest = z.infer<
  typeof AgentProfileCreateRequestSchema
>;

/** Bind a connected app to a profile, or (`profile_id: null`) back to the Guest agent. */
export const AgentBindRequestSchema = z.strictObject({
  client_id: z.string().min(1).max(2048),
  profile_id: IdSchema.nullable(),
});
export type AgentBindRequest = z.infer<typeof AgentBindRequestSchema>;

export interface AgentProfile {
  id: string;
  slug: string;
  display_name: string;
  kind: AgentKind;
  created_at: string;
}

/** An app the person allowed on the consent page, and the profile it acts as. */
export interface ConnectedApp {
  client_id: string;
  name: string | null;
  profile_id: string | null;
}
