// Making and refreshing entry vectors (D44). The vector is of what the writer said the entry is
// about: its title, summary and questions, never the raw body (BUILD-PLAN step 4). A vector is
// stale when the entry has a newer version or the server's model changed; stale and missing
// vectors are made in small batches after writes and searches, never inside a request's answer.
import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@sky-brain/db/client";
import { entries, entryVectors } from "@sky-brain/db/schema";
import type { Embedder } from "./embedder.ts";

/** Entries embedded per refresh call; one provider request. */
export const REFRESH_BATCH = 32;
/** Characters of text sent per entry; summaries are capped well below this. */
const MAX_TEXT = 4_000;

export function embeddingText(entry: {
  title: string;
  summary: string;
  questions: string[];
}): string {
  return [entry.title, entry.summary, ...entry.questions]
    .join("\n")
    .slice(0, MAX_TEXT);
}

/**
 * Embeds up to `limit` entries whose vector is missing or stale, in one workspace or all.
 * Returns how many it stored. Throws if the provider fails; callers that run it in the
 * background catch and log.
 */
export async function refreshVectors(
  db: DbOrTx,
  embedder: Embedder,
  options: { workspaceId?: string; limit?: number } = {},
): Promise<number> {
  const rows = await db
    .select({
      id: entries.id,
      version: entries.version,
      title: entries.title,
      summary: entries.summary,
      questions: entries.questions,
    })
    .from(entries)
    .leftJoin(entryVectors, eq(entryVectors.entryId, entries.id))
    .where(
      and(
        options.workspaceId
          ? eq(entries.workspaceId, options.workspaceId)
          : undefined,
        ne(entries.trust, "rejected"),
        or(
          isNull(entryVectors.entryId),
          lt(entryVectors.version, entries.version),
          ne(entryVectors.model, embedder.model),
        ),
      ),
    )
    .orderBy(entries.seq)
    .limit(options.limit ?? REFRESH_BATCH);
  if (rows.length === 0) return 0;
  const vectors = await embedder.embed(rows.map(embeddingText), "document");
  await db
    .insert(entryVectors)
    .values(
      rows.map((r, i) => ({
        entryId: r.id,
        version: r.version,
        model: embedder.model,
        embedding: vectors[i]!,
      })),
    )
    .onConflictDoUpdate({
      target: entryVectors.entryId,
      set: {
        version: sql`excluded.version`,
        model: sql`excluded.model`,
        embedding: sql`excluded.embedding`,
        createdAt: sql`now()`,
      },
    });
  return rows.length;
}
