// The `whoami` tool (spec.md Interfaces -> whoami): the caller's email and every workspace they
// are a member of. Identity comes from the verified token only, never from the arguments.
import type { Actor, AgentProfileRef, HatRef } from "@sky-brain/shared/actor";
import type { McpServer } from "@modelcontextprotocol/server";
import { and, asc, eq } from "drizzle-orm";
import { personOf } from "@sky-brain/kernel/actor/keys";
import type { Db } from "@sky-brain/db/client";
import { hats, members, user, workspaces } from "@sky-brain/db/schema";

export interface Whoami {
  email: string;
  user_id: string;
  workspaces: { id: string; name: string; role: string }[];
  /** For an agent: its id and the profile its person bound it to (null: the Guest agent). */
  agent?: { agent_id: string; profile: AgentProfileRef | null };
  /**
   * For an agent (D42): the hat its app is bound to (null: none), and the hats it may wear. Under
   * a bound hat that is the bound hat only; otherwise every hat of the brains the person owns, so
   * the agent can pick the one that fits the session, or ask.
   */
  hat?: HatRef | null;
  hats?: (HatRef & { description: string })[];
}

async function hatsFor(db: Db, actor: Actor & { kind: "agent" }) {
  const rows = await db
    .select({
      id: hats.id,
      slug: hats.slug,
      name: hats.name,
      description: hats.description,
    })
    .from(hats)
    .innerJoin(members, eq(members.workspaceId, hats.workspaceId))
    .where(
      and(eq(members.userId, actor.on_behalf_of), eq(members.role, "owner")),
    )
    .orderBy(asc(hats.createdAt), asc(hats.slug));
  return actor.hat ? rows.filter((h) => h.id === actor.hat!.id) : rows;
}

export async function whoami(db: Db, actor: Actor): Promise<Whoami> {
  const person = personOf(actor);
  const [row] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, person));
  // Filtered by this person's membership only (hard rule 4).
  const rows = await db
    .select({ id: workspaces.id, name: workspaces.name, role: members.role })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(eq(members.userId, person))
    .orderBy(asc(workspaces.createdAt), asc(workspaces.id));
  // A token outliving its user names nobody: an error, not an empty identity.
  if (!row) throw new Error("No such user.");
  const result: Whoami = {
    email: row.email,
    user_id: person,
    workspaces: rows,
  };
  if (actor.kind === "agent") {
    result.agent = { agent_id: actor.agent_id, profile: actor.profile ?? null };
    result.hat = actor.hat ?? null;
    result.hats = await hatsFor(db, actor);
  }
  return result;
}

export function registerWhoami(server: McpServer, db: Db, actor: Actor): void {
  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Connection check: returns the email of the person this connection acts for and " +
        "every sky-brain workspace they belong to, with their role in each, and the agent profile " +
        "(role) the person bound this app to, or null for the Guest agent; and the person's hats " +
        "(Parent, Engineer...) with the hat this app is bound to, if any. Takes no arguments.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const result = await whoami(db, actor);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: { ...result },
      };
    },
  );
}
