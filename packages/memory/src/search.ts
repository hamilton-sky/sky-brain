// Search over the entries the caller may read (BUILD-PLAN step 1 words, step 4 hybrid, D47).
// Words: any word of the query may match (the benchmark's `or` mode), ranked by `ts_rank_cd`
// over title, summary and body. With a query vector, the nearest entry vectors (title, summary,
// questions) are fetched too, and the two lists are fused with RRF. Agents see only proposed and
// approved entries that have not faded; people see everything but rejected unless they ask for
// a trust level. Both lists pass through the same `readable` filter.
import type { Actor } from "@sky-brain/shared/actor";
import type { SearchQuery } from "@sky-brain/shared/memory";
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@sky-brain/db/client";
import { entries, entryVectors, memories, members } from "@sky-brain/db/schema";
import {
  AGENT_READABLE,
  memberOfEntryWorkspace,
  type EntryRow,
} from "./entries-service.ts";
import { fuseRrf } from "./embed/rrf.ts";
import { workspaceRoles } from "./memories.ts";

/** How many entries each list hands to the fusion. */
export const FUSE_CANDIDATES = 50;
/**
 * Vectors further than this (cosine distance) are not a match at all, so a question about
 * nothing in the brain still finds nothing. Loose on purpose: RRF does the ranking.
 */
export const VECTOR_MAX_DISTANCE = 0.75;

export interface SearchOptions {
  /** What agents may read, whoever asks: the context packet uses it. */
  servedOnly?: boolean;
  /** The query's embedding; without it the search is words only. */
  queryVector?: number[];
}

export interface SearchHit {
  entry: EntryRow;
  /** ts_rank_cd for words only; the RRF score when vectors took part. */
  rank: number;
}

/** Who may read what: membership, About me for owners only, trust, fading, and the filters. */
function readable(
  actor: Actor,
  query: SearchQuery,
  now: Date,
  servedOnly: boolean,
) {
  const trustFilter =
    actor.kind === "agent" || servedOnly
      ? and(
          inArray(entries.trust, AGENT_READABLE),
          query.trust ? eq(entries.trust, query.trust) : undefined,
          or(isNull(entries.expiresAt), gt(entries.expiresAt, now)),
        )
      : query.trust
        ? eq(entries.trust, query.trust)
        : ne(entries.trust, "rejected");
  return and(
    or(ne(memories.layer, "core"), eq(members.role, "owner")),
    query.workspace_id
      ? eq(entries.workspaceId, query.workspace_id)
      : undefined,
    query.memory_id ? eq(entries.memoryId, query.memory_id) : undefined,
    query.layer ? eq(entries.layer, query.layer) : undefined,
    query.kind ? eq(entries.kind, query.kind) : undefined,
    trustFilter,
  );
}

/** pgvector's text form of a vector: `[0.1,0.2,...]`. */
export function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export async function searchEntries(
  db: DbOrTx,
  actor: Actor,
  query: SearchQuery,
  now: Date,
  options: SearchOptions = {},
): Promise<SearchHit[]> {
  if (query.workspace_id) await workspaceRoles(db, actor, query.workspace_id);
  const filter = readable(actor, query, now, options.servedOnly ?? false);
  const vector = query.q === undefined ? undefined : options.queryVector;
  const words = await wordHits(
    db,
    actor,
    query,
    filter,
    vector ? Math.max(query.limit, FUSE_CANDIDATES) : query.limit,
  );
  if (!vector) return words;
  const near = await vectorHits(
    db,
    actor,
    vector,
    filter,
    Math.max(query.limit, FUSE_CANDIDATES),
  );
  return fuseRrf([words, near], (h) => h.entry.id)
    .slice(0, query.limit)
    .map(({ item, score }) => ({ entry: item.entry, rank: score }));
}

/** Word search; without q, the place's newest entries (rank 0, newest first). */
async function wordHits(
  db: DbOrTx,
  actor: Actor,
  query: SearchQuery,
  filter: ReturnType<typeof readable>,
  limit: number,
): Promise<SearchHit[]> {
  const tsquery =
    query.q === undefined
      ? undefined
      : sql`to_tsquery('simple', replace(plainto_tsquery('simple', sb_norm(${query.q}))::text, '&', '|'))`;
  const rank = tsquery
    ? sql<number>`ts_rank_cd(${entries.search}, ${tsquery})`
    : sql<number>`0::real`;
  return db
    .select({ entry: entries, rank })
    .from(entries)
    .innerJoin(memories, eq(memories.id, entries.memoryId))
    .innerJoin(members, memberOfEntryWorkspace(actor))
    .where(
      and(tsquery ? sql`${entries.search} @@ ${tsquery}` : undefined, filter),
    )
    .orderBy(...(tsquery ? [desc(rank)] : []), desc(entries.seq))
    .limit(limit);
}

/** The nearest entry vectors by cosine distance, under the same filter. */
async function vectorHits(
  db: DbOrTx,
  actor: Actor,
  vector: number[],
  filter: ReturnType<typeof readable>,
  limit: number,
): Promise<SearchHit[]> {
  const distance = sql<number>`${entryVectors.embedding} <=> ${vectorLiteral(vector)}::halfvec`;
  const rows = await db
    .select({ entry: entries, distance })
    .from(entryVectors)
    .innerJoin(entries, eq(entries.id, entryVectors.entryId))
    .innerJoin(memories, eq(memories.id, entries.memoryId))
    .innerJoin(members, memberOfEntryWorkspace(actor))
    .where(and(sql`${distance} < ${VECTOR_MAX_DISTANCE}`, filter))
    .orderBy(distance)
    .limit(limit);
  return rows.map((r) => ({ entry: r.entry, rank: 1 - Number(r.distance) }));
}
