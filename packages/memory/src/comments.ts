// Comments on an entry: anyone who may read the entry reads its comments (an agent only on the
// proposed and approved entries it may read). A writer adds them, person or agent (D45: an
// agent's comment is marked as the agent's, never the person's words); only a person resolves,
// reopens or deletes one (CLAUDE.md hard rule 3).
import type { Actor } from "@sky-brain/shared/actor";
import {
  COMMENTS_PER_ENTRY_MAX,
  type CommentCreateRequest,
  type EntryComment,
} from "@sky-brain/shared/comments";
import { and, asc, count, eq } from "drizzle-orm";
import { auditActor, personOf } from "@sky-brain/kernel/actor/keys";
import { writeAudit } from "@sky-brain/db/audit";
import type { Db, DbOrTx } from "@sky-brain/db/client";
import { entryComments } from "@sky-brain/db/schema";
import { HttpError } from "@sky-brain/kernel/http/http-error";
import { refuseSecrets } from "@sky-brain/kernel/guards/write-guards";
import { findEntry, type EntryRow } from "./entries-service.ts";

type Human = Actor & { kind: "human" };
type CommentRow = typeof entryComments.$inferSelect;

function commentWire(row: CommentRow): EntryComment {
  return {
    id: row.id,
    entry_id: row.entryId,
    quote: row.quote,
    body: row.body,
    color: row.color,
    resolved: row.resolved,
    resolved_by: row.resolvedBy,
    resolved_at: row.resolvedAt?.toISOString() ?? null,
    author_kind: row.authorKind,
    author: row.author,
    created_at: row.createdAt.toISOString(),
  };
}

/** The comments of an entry the caller has already read (findEntry), oldest first. */
export async function commentsOf(
  db: DbOrTx,
  entry: EntryRow,
): Promise<EntryComment[]> {
  const rows = await db
    .select()
    .from(entryComments)
    .where(
      and(
        eq(entryComments.entryId, entry.id),
        eq(entryComments.workspaceId, entry.workspaceId),
      ),
    )
    .orderBy(asc(entryComments.createdAt), asc(entryComments.id));
  return rows.map(commentWire);
}

/** The entry, when the person may read it (404) and write in its workspace (403). */
async function writableEntry(
  db: DbOrTx,
  actor: Actor,
  entryId: string,
): Promise<EntryRow> {
  const { entry, role } = await findEntry(db, actor, entryId);
  if (role !== "owner" && role !== "editor") {
    throw new HttpError(403, "role_cannot_write", "A viewer cannot write.");
  }
  return entry;
}

const audit = (
  tx: DbOrTx,
  actor: Actor,
  entry: EntryRow,
  action: string,
  commentId: string,
) => {
  const who = auditActor(actor);
  return writeAudit(tx, {
    workspaceId: entry.workspaceId,
    actor: who.actor,
    action,
    targetId: entry.id,
    details: { ...who.details, comment_id: commentId },
  });
};

/** Who wrote or resolved a comment: the person's id, or the agent's (D45). */
const actorId = (actor: Actor) =>
  actor.kind === "human" ? actor.user_id : actor.agent_id;

export async function addComment(
  db: Db,
  actor: Actor,
  entryId: string,
  body: CommentCreateRequest,
  now: Date,
): Promise<EntryComment> {
  const entry = await writableEntry(db, actor, entryId);
  refuseSecrets([
    { name: "body", value: body.body },
    { name: "quote", value: body.quote ?? "" },
  ]);
  return db.transaction(async (tx) => {
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(entryComments)
      .where(eq(entryComments.entryId, entry.id));
    if (n >= COMMENTS_PER_ENTRY_MAX) {
      throw new HttpError(
        409,
        "too_many_comments",
        `An entry holds at most ${COMMENTS_PER_ENTRY_MAX} comments.`,
      );
    }
    const [row] = await tx
      .insert(entryComments)
      .values({
        entryId: entry.id,
        workspaceId: entry.workspaceId,
        quote: body.quote ?? null,
        body: body.body,
        color: body.color,
        authorKind: actor.kind,
        author: actorId(actor),
        onBehalfOf: personOf(actor),
        createdAt: now,
      })
      .returning();
    await audit(tx, actor, entry, "entry.comment.add", row!.id);
    return commentWire(row!);
  });
}

const noComment = () => new HttpError(404, "not_found", "No such comment.");

export async function setResolved(
  db: Db,
  actor: Human,
  entryId: string,
  commentId: string,
  resolved: boolean,
  now: Date,
): Promise<EntryComment> {
  const entry = await writableEntry(db, actor, entryId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(entryComments)
      .set(
        resolved
          ? { resolved, resolvedBy: actorId(actor), resolvedAt: now }
          : { resolved, resolvedBy: null, resolvedAt: null },
      )
      .where(
        and(
          eq(entryComments.id, commentId),
          eq(entryComments.entryId, entry.id),
          eq(entryComments.workspaceId, entry.workspaceId),
        ),
      )
      .returning();
    if (!row) throw noComment();
    const action = resolved ? "entry.comment.resolve" : "entry.comment.reopen";
    await audit(tx, actor, entry, action, row.id);
    return commentWire(row);
  });
}

export async function deleteComment(
  db: Db,
  actor: Human,
  entryId: string,
  commentId: string,
): Promise<void> {
  const entry = await writableEntry(db, actor, entryId);
  await db.transaction(async (tx) => {
    const gone = await tx
      .delete(entryComments)
      .where(
        and(
          eq(entryComments.id, commentId),
          eq(entryComments.entryId, entry.id),
          eq(entryComments.workspaceId, entry.workspaceId),
        ),
      )
      .returning({ id: entryComments.id });
    if (gone.length === 0) throw noComment();
    await audit(tx, actor, entry, "entry.comment.delete", commentId);
  });
}
