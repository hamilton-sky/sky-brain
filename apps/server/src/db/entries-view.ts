// Maps an entries row to the wire Entry, with the effective status computed at read time.
import type { Entry } from "@sky-brain/shared/entry";
import type { Status } from "@sky-brain/shared/enums";
import { and, gt, isNull, ne, notInArray, or, type SQL } from "drizzle-orm";
import { entries } from "./schema.ts";

export type EntryRow = typeof entries.$inferSelect;

const EXPIRING: Status[] = ["proposed", "open"];

/** A proposed or open entry whose `expires_at` is at or before `now` reads `expired`. */
export function effectiveStatus(row: EntryRow, now: Date): Status {
  if (
    EXPIRING.includes(row.status) &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() <= now.getTime()
  ) {
    return "expired";
  }
  return row.status;
}

/** The SQL twin of `effectiveStatus(row, now) !== "expired"`, for queries. */
export function notExpiredAt(now: Date): SQL {
  return and(
    ne(entries.status, "expired"),
    or(
      notInArray(entries.status, EXPIRING),
      isNull(entries.expiresAt),
      gt(entries.expiresAt, now),
    ),
  )!;
}

export function toWireEntry(row: EntryRow, now: Date): Entry {
  const status = effectiveStatus(row, now);
  return {
    id: row.id,
    seq: row.seq,
    workspace_id: row.workspaceId,
    project_id: row.projectId,
    feature_id: row.featureId,
    kind: row.kind,
    status,
    title: row.title,
    body: row.body,
    author_kind: row.authorKind,
    author: row.author,
    on_behalf_of: row.onBehalfOf,
    source: row.source,
    refs: row.refs,
    reply_to: row.replyTo,
    supersedes: row.supersedes,
    confidence: row.confidence,
    expires_at: row.expiresAt?.toISOString() ?? null,
    allow_agent_answers: row.allowAgentAnswers,
    quarantined_because:
      status === "quarantined" ? row.quarantinedBecause : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
