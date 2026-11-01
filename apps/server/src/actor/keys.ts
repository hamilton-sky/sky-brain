// The strings other code derives from an actor.
import type { Actor } from "@sky-brain/shared/actor";

/** The person whose membership and role count: the human, or the person the agent acts for. */
export function personOf(actor: Actor): string {
  return actor.kind === "human" ? actor.user_id : actor.on_behalf_of;
}

/** The rate limiter's bucket key. */
export function actorKey(actor: Actor): string {
  return actor.kind === "human"
    ? `human:${actor.user_id}`
    : `agent:${actor.agent_id}:${actor.on_behalf_of}`;
}

/** The `actor` string of an audit row, and what its `details` carry about the actor. */
export function auditActor(actor: Actor): {
  actor: string;
  details: { on_behalf_of?: string };
} {
  return actor.kind === "human"
    ? { actor: `human:${actor.user_id}`, details: {} }
    : {
        actor: `agent:${actor.agent_id}`,
        details: { on_behalf_of: actor.on_behalf_of },
      };
}
