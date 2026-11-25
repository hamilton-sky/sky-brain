// Entries and versions as the API returns them (packages/shared/src/memory.ts).
import type { Entry, EntryVersion } from "@sky-brain/shared/memory";
import type { EntryRow, VersionRow } from "./entries-service.ts";

/** The wire entry; `withBody` adds the body (search results carry the summary only). */
export function entryWire(row: EntryRow, withBody: boolean): Entry {
  return {
    id: row.id,
    seq: row.seq,
    workspace_id: row.workspaceId,
    memory_id: row.memoryId,
    layer: row.layer,
    kind: row.kind,
    topic: row.topic,
    trust: row.trust,
    title: row.title,
    summary: row.summary,
    summary_source: row.summarySource,
    questions: row.questions,
    refs: row.refs,
    version: row.version,
    author_kind: row.authorKind,
    author: row.author,
    on_behalf_of: row.onBehalfOf,
    source: row.source,
    quarantined_because: row.quarantinedBecause,
    expires_at: row.expiresAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    ...(withBody ? { body: row.body } : {}),
  };
}

export function versionWire(row: VersionRow): EntryVersion {
  return {
    version: row.version,
    kind: row.kind,
    topic: row.topic,
    title: row.title,
    body: row.body,
    summary: row.summary,
    summary_source: row.summarySource,
    author_kind: row.authorKind,
    author: row.author,
    created_at: row.createdAt.toISOString(),
  };
}
