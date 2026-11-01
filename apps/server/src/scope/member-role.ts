// The role of the human, or of the person an agent acts for, in one workspace.
import type { Actor } from "@sky-brain/shared/actor";
import type { Role } from "@sky-brain/shared/enums";
import { and, eq } from "drizzle-orm";
import { personOf } from "../actor/keys.ts";
import type { DbOrTx } from "../db/client.ts";
import { members } from "../db/schema.ts";

/** Undefined when the person has no `members` row there: the caller answers 404. */
export async function memberRole(
  db: DbOrTx,
  workspaceId: string,
  actor: Actor,
): Promise<Role | undefined> {
  const [row] = await db
    .select({ role: members.role })
    .from(members)
    .where(
      and(
        eq(members.workspaceId, workspaceId),
        eq(members.userId, personOf(actor)),
      ),
    );
  return row?.role;
}
