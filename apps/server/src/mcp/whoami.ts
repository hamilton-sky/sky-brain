// The `whoami` tool (spec.md Interfaces -> whoami): the caller's email and every workspace they
// are a member of. Identity comes from the verified token only, never from the arguments.
import type { Actor } from "@sky-brain/shared/actor";
import type { McpServer } from "@modelcontextprotocol/server";
import { asc, eq } from "drizzle-orm";
import { personOf } from "../actor/keys.ts";
import type { Db } from "../db/client.ts";
import { members, user, workspaces } from "../db/schema.ts";

export interface Whoami {
  email: string;
  user_id: string;
  workspaces: { id: string; name: string; role: string }[];
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
  return { email: row.email, user_id: person, workspaces: rows };
}

export function registerWhoami(server: McpServer, db: Db, actor: Actor): void {
  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Connection check: returns the email of the person this connection acts for and " +
        "every sky-brain workspace they belong to, with their role in each. Takes no arguments.",
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
