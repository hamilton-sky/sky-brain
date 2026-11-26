// What a hat lets an agent see (D30, D44): the shared self plus the active hat's part. A memory
// with no hat is shared across hats; an About me entry with no hat tags is the shared self.
// People and agents without a hat see everything they saw before. A hat only ever narrows.
import type { Actor } from "@sky-brain/shared/actor";
import { and, eq, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@sky-brain/db/client";
import { coreEntryHats, entries, memories } from "@sky-brain/db/schema";

/** The hat the caller works under, if any. */
export function activeHatId(actor: Actor): string | undefined {
  return actor.kind === "agent" ? actor.hat?.id : undefined;
}

/** For a query that joins `memories`: only memories shared or of the active hat. */
export function memoryInHat(actor: Actor): SQL | undefined {
  const hat = activeHatId(actor);
  return hat ? or(isNull(memories.hatId), eq(memories.hatId, hat)) : undefined;
}

/** For a query over `entries` joined with `memories`: the memory rule plus About me's tags. */
export function entryInHat(actor: Actor): SQL | undefined {
  const hat = activeHatId(actor);
  if (!hat) return undefined;
  const tagged = sql`exists (select 1 from ${coreEntryHats} where ${coreEntryHats.entryId} = ${entries.id})`;
  const taggedHere = sql`exists (select 1 from ${coreEntryHats} where ${coreEntryHats.entryId} = ${entries.id} and ${coreEntryHats.hatId} = ${hat})`;
  return and(
    memoryInHat(actor),
    or(ne(entries.layer, "core"), sql`not ${tagged}`, taggedHere),
  );
}

/** Whether one memory row is within the caller's hat. */
export function memoryRowInHat(
  actor: Actor,
  memory: { hatId: string | null },
): boolean {
  const hat = activeHatId(actor);
  return !hat || memory.hatId === null || memory.hatId === hat;
}

/** Whether one About me entry is within the caller's hat (other layers follow their memory). */
export async function coreEntryInHat(
  db: DbOrTx,
  actor: Actor,
  entry: { id: string; layer: string },
): Promise<boolean> {
  const hat = activeHatId(actor);
  if (!hat || entry.layer !== "core") return true;
  const tags = await db
    .select({ hatId: coreEntryHats.hatId })
    .from(coreEntryHats)
    .where(eq(coreEntryHats.entryId, entry.id));
  return tags.length === 0 || tags.some((t) => t.hatId === hat);
}
