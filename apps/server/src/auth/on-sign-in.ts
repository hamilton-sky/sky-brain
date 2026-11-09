// What a sign-in gives (spec.md Decisions -> When the own workspace and invites are applied):
// an own workspace when the person belongs to none, then every pending invite for their email.
// Runs as Better Auth's `databaseHooks.session.create.after`, so on every sign-in. The user id
// and email come from the session row and the `user` table, never from the request.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { invites, members, user, workspaces } from "../db/schema.ts";

export async function onSignIn(
  db: Db,
  who: { userId: string; email: string },
): Promise<void> {
  const email = who.email.toLowerCase();
  await db.transaction(async (tx) => {
    const [member] = await tx
      .select({ workspaceId: members.workspaceId })
      .from(members)
      .where(eq(members.userId, who.userId))
      .limit(1);
    if (!member) {
      const [ws] = await tx
        .insert(workspaces)
        .values({ name: email })
        .returning({ id: workspaces.id });
      await tx
        .insert(members)
        .values({ workspaceId: ws!.id, userId: who.userId, role: "owner" });
    }

    const pending = await tx
      .select({
        id: invites.id,
        workspaceId: invites.workspaceId,
        role: invites.role,
      })
      .from(invites)
      .where(
        and(
          sql`lower(${invites.email}) = ${email}`,
          isNull(invites.acceptedAt),
        ),
      );
    for (const invite of pending) {
      // A role the person already holds there is kept.
      await tx
        .insert(members)
        .values({
          workspaceId: invite.workspaceId,
          userId: who.userId,
          role: invite.role,
        })
        .onConflictDoNothing();
      await tx
        .update(invites)
        .set({ acceptedAt: new Date() })
        .where(eq(invites.id, invite.id));
    }
  });
}

/** The `databaseHooks.session.create.after` hook: looks the email up by the session's user. */
export function onSessionCreated(db: Db) {
  return async (session: { userId: string }): Promise<void> => {
    const [row] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, session.userId));
    if (row) await onSignIn(db, { userId: session.userId, email: row.email });
  };
}
