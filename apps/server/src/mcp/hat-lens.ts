// The hat lens (D30, D44): an agent may pass `hat` on a memory call to work under one of the
// person's hats for that call, picked from the session's context (whoami lists them). A lens only
// narrows what the agent sees, so it is safe to take from the model. An app the person bound to
// a hat is walled in: it may name only that hat, and any other is refused.
import type { Actor } from "@sky-brain/shared/actor";
import { HatSlugSchema } from "@sky-brain/shared/hats";
import { and, eq } from "drizzle-orm";
import type { Db } from "@sky-brain/db/client";
import { hats, members } from "@sky-brain/db/schema";
import type { BoardCall } from "./board-dispatch.ts";

/** The `hat` argument every memory tool takes. */
export const hatArg = HatSlugSchema.optional().describe(
  "The hat (from whoami's hats) to work under for this call: you see the shared self plus " +
    "that hat's part, and what you capture records it. Pick the one that fits the person's " +
    "request; ask them when you cannot tell. Leave out for no hat.",
);

/** The caller for one call, under the hat it names (or as it is, when it names none). */
export type CallFor = (hat: string | undefined) => Promise<BoardCall>;

const refuse =
  (status: number, code: string, message: string): BoardCall =>
  () =>
    Promise.resolve({ status, body: { error: { code, message } } });

export function hatLens(
  db: Db,
  actor: Actor,
  forActor: (a: Actor) => BoardCall,
): CallFor {
  const plain = forActor(actor);
  return async (slug) => {
    if (slug === undefined || actor.kind !== "agent") return plain;
    if (actor.hat) {
      return slug === actor.hat.slug
        ? plain
        : refuse(
            403,
            "hat_bound",
            `This app always works under the ${actor.hat.name} hat; the person set that on the Agents page.`,
          );
    }
    // Only a hat of a brain the person owns (hard rule 4).
    const [hat] = await db
      .select({ id: hats.id, slug: hats.slug, name: hats.name })
      .from(hats)
      .innerJoin(members, eq(members.workspaceId, hats.workspaceId))
      .where(
        and(
          eq(members.userId, actor.on_behalf_of),
          eq(members.role, "owner"),
          eq(hats.slug, slug),
        ),
      )
      .limit(1);
    if (!hat) {
      return refuse(404, "no_such_hat", "No hat by that name; see whoami.");
    }
    return forActor({ ...actor, hat });
  };
}
