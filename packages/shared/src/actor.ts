// Who is calling (spec.md Interfaces -> How a test reaches the server). Identity comes from the
// token, the session or the dev actor header, never from a request body (CLAUDE.md hard rule 2).
import { z } from "zod";

export const UserIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const AgentIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,63}$/);

export const ActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human"), user_id: UserIdSchema }),
  z.object({
    kind: z.literal("agent"),
    agent_id: AgentIdSchema,
    on_behalf_of: UserIdSchema,
  }),
]);
export type Actor = z.infer<typeof ActorSchema>;
