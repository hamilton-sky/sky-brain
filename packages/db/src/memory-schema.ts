// Memory core tables, thin step 1 (docs/vision/schema/MEMORY-SCHEMA.md, BUILD-PLAN step 1),
// re-exported from schema.ts. After a change, run
// `pnpm --filter @sky-brain/db exec drizzle-kit generate`.
//
// Like tasks-schema.ts, this module loads before schema.ts finishes, so anything from schema.ts
// is used only inside callbacks, and `author_kind` is text with a check.
import type { AuthorKind } from "@sky-brain/shared/enums";
import {
  EMBEDDING_DIMS,
  ENTRY_SOURCES,
  ENTRY_TOPICS,
  KNOWLEDGE_KINDS,
  MEMORY_LAYERS,
  SUMMARY_SOURCES,
  TRUST_LEVELS,
} from "@sky-brain/shared/memory";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  halfvec,
  index,
  integer,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { at, createdAt, createdBy, id, textArray } from "./columns.ts";
import { workspaces } from "./schema.ts";

export const memoryLayerEnum = pgEnum("memory_layer", MEMORY_LAYERS);
export const knowledgeKindEnum = pgEnum("knowledge_kind", KNOWLEDGE_KINDS);
export const trustLevelEnum = pgEnum("trust_level", TRUST_LEVELS);
export const entryTopicEnum = pgEnum("entry_topic", ENTRY_TOPICS);
export const entrySourceEnum = pgEnum("entry_source", ENTRY_SOURCES);
export const summarySourceEnum = pgEnum("summary_source", SUMMARY_SOURCES);

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** The columns one version of an entry holds: its text, kind and summary. */
const entryText = () => ({
  kind: knowledgeKindEnum("kind").notNull(),
  topic: entryTopicEnum("topic"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  summary: text("summary").notNull(),
  summarySource: summarySourceEnum("summary_source").notNull(),
  questions: textArray("questions"),
  refs: textArray("refs"),
});

/**
 * A memory is a container with a fixed layer. Exactly one `core` (About me) per brain; at most
 * one default per layer, which captures land in when no memory is named.
 */
export const memories = pgTable(
  "memories",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    layer: memoryLayerEnum("layer").notNull(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("memories_id_ws_layer_unique").on(t.id, t.workspaceId, t.layer),
    uniqueIndex("memories_one_core")
      .on(t.workspaceId)
      .where(sql`${t.layer} = 'core'`),
    uniqueIndex("memories_one_default_per_layer")
      .on(t.workspaceId, t.layer)
      .where(sql`${t.isDefault}`),
    check(
      "memories_core_is_default",
      sql`${t.layer} <> 'core' or ${t.isDefault}`,
    ),
  ],
);

/** Every insert and every change of an entry draws from it: a "what changed since" cursor. */
export const entriesSeq = pgSequence("entries_seq");

/**
 * An entry: its identity and the head of its history (the current version's text). It never
 * moves: `memory_id`, `workspace_id` and `layer` are fixed by a trigger (0008). The layer is a
 * copy of the memory's, kept honest by the composite foreign key.
 */
export const entries = pgTable(
  "entries",
  {
    id: id(),
    seq: bigint("seq", { mode: "number" })
      .notNull()
      .default(sql`nextval('entries_seq')`),
    workspaceId: uuid("workspace_id").notNull(),
    memoryId: uuid("memory_id").notNull(),
    layer: memoryLayerEnum("layer").notNull(),
    trust: trustLevelEnum("trust").notNull(),
    version: integer("version").notNull().default(1),
    ...entryText(),
    ...createdBy(),
    source: entrySourceEnum("source").notNull(),
    /** The quarantine pattern that held the latest text, or `web_source`. */
    quarantinedBecause: text("quarantined_because"),
    /** Inbox entries fade from agents' default retrieval after this. */
    expiresAt: at("expires_at"),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
    // Word search on the whole body; 'simple' plus sb_norm (0005) works for Hebrew and English.
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', sb_norm("title")), 'A') || setweight(to_tsvector('simple', sb_norm("summary" || ' ' || sb_join("questions"))), 'B') || setweight(to_tsvector('simple', sb_norm("body")), 'C')`,
    ),
  },
  (t) => [
    foreignKey({
      name: "entries_in_memory_fk",
      columns: [t.memoryId, t.workspaceId, t.layer],
      foreignColumns: [memories.id, memories.workspaceId, memories.layer],
    }).onDelete("cascade"),
    check("entries_author_kind", sql`${t.authorKind} in ('human', 'agent')`),
    // Hard rule 3: only a person writes About me.
    check(
      "entries_core_human",
      sql`${t.layer} <> 'core' or ${t.authorKind} = 'human'`,
    ),
    check(
      "entries_short_fades",
      sql`(${t.layer} = 'short') = (${t.expiresAt} is not null)`,
    ),
    check(
      "entries_external_kind",
      sql`${t.source} not in ('web', 'import') or ${t.kind} = 'external'`,
    ),
    check(
      "entries_quarantine_reason",
      sql`(${t.trust} = 'quarantined') = (${t.quarantinedBecause} is not null)`,
    ),
    index("entries_search_idx").using("gin", t.search),
    index("entries_workspace_seq_idx").on(t.workspaceId, t.seq),
    index("entries_memory_idx").on(t.memoryId, t.trust),
  ],
);

/** Append-only (0008): every version of an entry's text, kind and summary. */
export const entryVersions = pgTable(
  "entry_versions",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    ...entryText(),
    authorKind: text("author_kind").$type<AuthorKind>().notNull(),
    author: text("author").notNull(),
    quarantinedBecause: text("quarantined_because"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.version] }),
    check(
      "entry_versions_author_kind",
      sql`${t.authorKind} in ('human', 'agent')`,
    ),
  ],
);

/**
 * One vector per entry (D47, BUILD-PLAN step 4): the embedding of its title, summary and
 * questions, made by the server's embedding model, the one model call sky-brain makes. Its own
 * table, so storing a vector is not a change of the entry (no new `seq`, no `updated_at`).
 * `version` is the entry version it was made from; an older one is stale and is made again.
 */
export const entryVectors = pgTable(
  "entry_vectors",
  {
    entryId: uuid("entry_id")
      .primaryKey()
      .references(() => entries.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    model: text("model").notNull(),
    embedding: halfvec("embedding", { dimensions: EMBEDDING_DIMS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("entry_vectors_hnsw_idx").using(
      "hnsw",
      t.embedding.op("halfvec_cosine_ops"),
    ),
  ],
);
