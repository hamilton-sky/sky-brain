// Hats (D30, D42): the queries. A hat belongs to one brain (workspace); a person manages the
// hats of the brain they own and binds the apps they connected to one. Every query filters by
// that workspace or by the person (hard rule 4).
import type { HatRef } from "@sky-brain/shared/actor";
import type { Actor } from "@sky-brain/shared/actor";
import type { Hat, HatCreateRequest } from "@sky-brain/shared/hats";
import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@sky-brain/db/client";
import { hatBindings, hats, memories } from "@sky-brain/db/schema";
import { hasConsented } from "./profiles.ts";

type HatRow = typeof hats.$inferSelect;

function toWire(row: HatRow): Hat {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    color: row.color,
    created_at: row.createdAt.toISOString(),
  };
}

export async function listHats(
  db: DbOrTx,
  workspaceId: string,
): Promise<Hat[]> {
  const rows = await db
    .select()
    .from(hats)
    .where(eq(hats.workspaceId, workspaceId))
    .orderBy(asc(hats.createdAt), asc(hats.slug));
  return rows.map(toWire);
}

/** Undefined when the brain already has a hat with that slug. */
export async function createHat(
  db: DbOrTx,
  workspaceId: string,
  request: HatCreateRequest,
): Promise<Hat | undefined> {
  const [row] = await db
    .insert(hats)
    .values({
      workspaceId,
      slug: request.slug,
      name: request.name,
      description: request.description,
      color: request.color ?? null,
    })
    .onConflictDoNothing()
    .returning();
  return row ? toWire(row) : undefined;
}

export type DeleteHatResult = "deleted" | "not_found" | "in_use";

/**
 * Delete a hat of this brain. Refused while a memory still belongs to it: the person moves those
 * memories back to shared first, so nothing is lost by accident. Its tags and bindings go with it.
 */
export async function deleteHat(
  db: DbOrTx,
  workspaceId: string,
  hatId: string,
): Promise<DeleteHatResult> {
  const [used] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(
      and(eq(memories.workspaceId, workspaceId), eq(memories.hatId, hatId)),
    )
    .limit(1);
  if (used) return "in_use";
  const rows = await db
    .delete(hats)
    .where(and(eq(hats.id, hatId), eq(hats.workspaceId, workspaceId)))
    .returning({ id: hats.id });
  return rows.length > 0 ? "deleted" : "not_found";
}

export type BindHatResult = "bound" | "unbound" | "no_app" | "no_hat";

/** Bind an app the person consented to a hat of their own brain, or unbind it (`null`). */
export async function bindHat(
  db: DbOrTx,
  person: string,
  workspaceId: string,
  clientId: string,
  hatId: string | null,
): Promise<BindHatResult> {
  if (!(await hasConsented(db, person, clientId))) return "no_app";
  if (hatId === null) {
    await db
      .delete(hatBindings)
      .where(
        and(eq(hatBindings.userId, person), eq(hatBindings.clientId, clientId)),
      );
    return "unbound";
  }
  const [hat] = await db
    .select({ id: hats.id })
    .from(hats)
    .where(and(eq(hats.id, hatId), eq(hats.workspaceId, workspaceId)));
  if (!hat) return "no_hat";
  await db
    .insert(hatBindings)
    .values({ userId: person, clientId, hatId })
    .onConflictDoUpdate({
      target: [hatBindings.userId, hatBindings.clientId],
      set: { hatId, createdAt: new Date() },
    });
  return "bound";
}

/** The hat the person bound this app to; undefined when it works under no hat. */
export async function boundHat(
  db: DbOrTx,
  person: string,
  clientId: string,
): Promise<HatRef | undefined> {
  const [row] = await db
    .select({ id: hats.id, slug: hats.slug, name: hats.name })
    .from(hatBindings)
    .innerJoin(hats, eq(hats.id, hatBindings.hatId))
    .where(
      and(eq(hatBindings.userId, person), eq(hatBindings.clientId, clientId)),
    );
  return row;
}

/** The agent under its bound hat. A human, or an agent with no hat, is returned as it is. */
export function withHat(actor: Actor, hat: HatRef | undefined): Actor {
  if (actor.kind !== "agent" || !hat) return actor;
  return { ...actor, hat };
}
