// Documents attached to goals: list a goal's documents (summaries only, never bodies) and attach
// or detach one. Attaching needs a writer on the goal's workspace and an entry the caller may
// read in that same workspace; an agent may attach but never detach (CLAUDE.md hard rule 3).
import type { Actor } from "@sky-brain/shared/actor";
import {
  GOAL_DOCUMENTS_MAX,
  type GoalDocument,
} from "@sky-brain/shared/goal-docs";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { personOf } from "@sky-brain/kernel/actor/keys";
import type { DbOrTx } from "@sky-brain/db/client";
import { entries, goalDocuments } from "@sky-brain/db/schema";
import { HttpError } from "@sky-brain/kernel/http/http-error";
import { findEntry } from "@sky-brain/memory/entries-service";
import { audit } from "./goals-service.ts";
import type { GoalRow } from "./wire.ts";

const noEntry = () => new HttpError(404, "not_found", "No such entry.");

/** Each goal's documents, oldest attached first. Agents see only proposed or approved entries. */
export async function documentsOf(
  db: DbOrTx,
  actor: Actor,
  goalIds: string[],
): Promise<Map<string, GoalDocument[]>> {
  const out = new Map<string, GoalDocument[]>(goalIds.map((id) => [id, []]));
  if (goalIds.length === 0) return out;
  const rows = await db
    .select({ link: goalDocuments, entry: entries })
    .from(goalDocuments)
    .innerJoin(entries, eq(entries.id, goalDocuments.entryId))
    .where(
      and(
        inArray(goalDocuments.goalId, goalIds),
        // The link and the entry are in the same workspace; this keeps it so even if one moved.
        eq(entries.workspaceId, goalDocuments.workspaceId),
        actor.kind === "agent"
          ? inArray(entries.trust, ["proposed", "approved"])
          : undefined,
      ),
    )
    .orderBy(asc(goalDocuments.createdAt), asc(goalDocuments.entryId));
  for (const { link, entry } of rows) {
    out.get(link.goalId)?.push({
      entry_id: entry.id,
      memory_id: entry.memoryId,
      layer: entry.layer,
      kind: entry.kind,
      trust: entry.trust,
      title: entry.title,
      summary: entry.summary,
      version: entry.version,
      author_kind: entry.authorKind,
      author: entry.author,
      quarantined_because: entry.quarantinedBecause,
      updated_at: entry.updatedAt.toISOString(),
      attached_by: link.author,
      attached_at: link.createdAt.toISOString(),
    });
  }
  return out;
}

/**
 * Inside the caller's transaction, with the goal row locked and the caller's write role checked:
 * 409 `invalid_state` for a cancelled goal; 404 for an entry the caller may not read or that is
 * in another workspace; 409 `too_many_documents` past the cap. Attaching twice is a no-op.
 */
export async function attachDocument(
  tx: DbOrTx,
  actor: Actor,
  goal: GoalRow,
  entryId: string,
  now: Date,
): Promise<void> {
  if (goal.status === "cancelled") {
    throw new HttpError(
      409,
      "invalid_state",
      "A cancelled goal takes no documents.",
    );
  }
  let entryWorkspace: string;
  try {
    entryWorkspace = (await findEntry(tx, actor, entryId)).entry.workspaceId;
  } catch {
    throw noEntry();
  }
  if (entryWorkspace !== goal.workspaceId) throw noEntry();
  const [{ n } = { n: 0 }] = await tx
    .select({ n: count() })
    .from(goalDocuments)
    .where(eq(goalDocuments.goalId, goal.id));
  if (n >= GOAL_DOCUMENTS_MAX) {
    throw new HttpError(
      409,
      "too_many_documents",
      `A goal holds at most ${GOAL_DOCUMENTS_MAX} documents.`,
    );
  }
  const inserted = await tx
    .insert(goalDocuments)
    .values({
      goalId: goal.id,
      entryId,
      workspaceId: goal.workspaceId,
      authorKind: actor.kind,
      author: actor.kind === "human" ? actor.user_id : actor.agent_id,
      onBehalfOf: personOf(actor),
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ entryId: goalDocuments.entryId });
  if (inserted.length > 0) {
    await audit(tx, actor, goal, "goal.document.attach", {
      entry_id: entryId,
    });
  }
}

/** A person removes a document from a goal (the entry itself stays). 404 when not attached. */
export async function detachDocument(
  tx: DbOrTx,
  actor: Actor,
  goal: GoalRow,
  entryId: string,
): Promise<void> {
  const gone = await tx
    .delete(goalDocuments)
    .where(
      and(
        eq(goalDocuments.goalId, goal.id),
        eq(goalDocuments.entryId, entryId),
      ),
    )
    .returning({ entryId: goalDocuments.entryId });
  if (gone.length === 0) throw noEntry();
  await audit(tx, actor, goal, "goal.document.detach", { entry_id: entryId });
}
