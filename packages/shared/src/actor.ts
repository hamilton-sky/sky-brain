// Who is calling (spec.md Interfaces -> How a test reaches the server). Identity comes from the
// token, the session or the dev actor header, never from a request body (CLAUDE.md hard rule 2).
import { z } from "zod";
import { AgentSlugSchema } from "./agents.ts";
import { HatSlugSchema } from "./hats.ts";

export const UserIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
// Room for `mcp/<client host>/<profile slug>` (D25).
export const AgentIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,127}$/);

/** The profile a person bound the calling app to (D25); absent for the Guest agent. */
export const AgentProfileRefSchema = z.object({
  id: z.uuid(),
  slug: AgentSlugSchema,
  display_name: z.string().min(1).max(60),
});
export type AgentProfileRef = z.infer<typeof AgentProfileRefSchema>;

/**
 * The hat the calling app runs under (D30). It only narrows what the agent sees and is recorded
 * on what it writes (capture_hat); it never grants a right. Absent means no hat.
 */
export const HatRefSchema = z.object({
  id: z.uuid(),
  slug: HatSlugSchema,
  name: z.string().min(1).max(60),
});

export type HatRef = z.infer<typeof HatRefSchema>;

export const ActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human"), user_id: UserIdSchema }),
  z.object({
    kind: z.literal("agent"),
    agent_id: AgentIdSchema,
    on_behalf_of: UserIdSchema,
    profile: AgentProfileRefSchema.optional(),
    hat: HatRefSchema.optional(),
  }),
]);
export type Actor = z.infer<typeof ActorSchema>;
