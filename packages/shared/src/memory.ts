// The memory core, thin step 1 (docs/vision/schema/MEMORY-SCHEMA.md, BUILD-PLAN step 1): the
// enums, the strict request schemas and size caps of the entries and memories routes, and the
// wire `Memory` and `Entry`.
import { z } from "zod";
import type { AuthorKind } from "./enums.ts";
import { IdSchema } from "./scope.ts";

/** One `core` (About me) per person; many `long` (Notebooks) and `short` (Inboxes). */
export const MEMORY_LAYERS = ["core", "long", "short", "working"] as const;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];

/** D22: what sort of statement an entry is. */
export const KNOWLEDGE_KINDS = [
  "fact",
  "decision",
  "hypothesis",
  "observation",
  "external",
] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** D22: how far a person has vetted it. Only a person moves it to `approved` or `rejected`. */
export const TRUST_LEVELS = [
  "quarantined",
  "proposed",
  "approved",
  "rejected",
] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

/** D22: what the entry is about, separate from its kind. Optional. */
export const ENTRY_TOPICS = [
  "rule",
  "question",
  "answer",
  "lesson",
  "note",
  "artifact",
] as const;
export type EntryTopic = (typeof ENTRY_TOPICS)[number];

/** Where the text came from. `web` and `import` make the kind `external`; `web` is quarantined. */
export const ENTRY_SOURCES = ["human", "agent", "web", "import"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

/** `writer`: the author wrote it. `fallback`: the server made it from the title and body. */
export const SUMMARY_SOURCES = ["writer", "fallback"] as const;
export type SummarySource = (typeof SUMMARY_SOURCES)[number];

export const MEMORY_CAPS = {
  name: 80,
  title: 200,
  bodyBytes: 16_384,
  summary: 600,
  questions: 3,
  question: 200,
  refs: 20,
  ref: 2_048,
  query: 500,
} as const;

/** How long an Inbox (short) entry stays in agents' default retrieval. */
export const INBOX_TTL_DAYS = 30;
export const SEARCH_LIMIT_DEFAULT = 10;
export const SEARCH_LIMIT_MAX = 50;
/** How much of the body the fallback summary takes. */
export const FALLBACK_SUMMARY_CHARS = 500;

const TOO_LARGE = { too_large: true };
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

const title = z.string().trim().min(1).max(MEMORY_CAPS.title);
const body = z
  .string()
  .min(1)
  .refine((s) => utf8Bytes(s) <= MEMORY_CAPS.bodyBytes, {
    message: `At most ${MEMORY_CAPS.bodyBytes} UTF-8 bytes.`,
    params: TOO_LARGE,
  });
const summary = z.string().trim().min(1).max(MEMORY_CAPS.summary);
const questions = z
  .array(z.string().trim().min(1).max(MEMORY_CAPS.question))
  .max(MEMORY_CAPS.questions);
const refs = z
  .array(z.string().min(1).max(MEMORY_CAPS.ref))
  .max(MEMORY_CAPS.refs);
// A memory's name is shown inside the fenced packet, so it is plain words only (R1-14).
const memoryName = z
  .string()
  .trim()
  .min(1)
  .max(MEMORY_CAPS.name)
  .regex(
    /^[\p{L}\p{N} _.,'()&-]+$/u,
    "Letters, digits, spaces and . , ' ( ) & - _ only.",
  );

/**
 * `POST /api/v1/entries` (capture). No `memory_id`: the default Inbox of `workspace_id`, or of
 * the caller's own brain. An agent must send `summary` (the owner's rule, 23 Nov); a person may
 * leave it out and the server writes a fallback. Trust, author and layer come from the server.
 */
export const CaptureRequestSchema = z.strictObject({
  memory_id: IdSchema.optional(),
  workspace_id: IdSchema.optional(),
  kind: z.enum(KNOWLEDGE_KINDS),
  topic: z.enum(ENTRY_TOPICS).optional(),
  title,
  body,
  summary: summary.optional(),
  questions: questions.optional(),
  refs: refs.optional(),
  source: z.enum(["web", "import"]).optional(),
});
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

/** `POST /api/v1/entries/:id/versions`: a person's new version. Nothing is edited in place. */
export const ReviseRequestSchema = z.strictObject({
  kind: z.enum(KNOWLEDGE_KINDS).optional(),
  topic: z.enum(ENTRY_TOPICS).nullable().optional(),
  title: title.optional(),
  body: body.optional(),
  summary: summary.optional(),
  questions: questions.optional(),
  refs: refs.optional(),
});
export type ReviseRequest = z.infer<typeof ReviseRequestSchema>;

/** `GET /api/v1/entries?q=`. Query values arrive as strings. */
export const SearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(MEMORY_CAPS.query),
  workspace_id: IdSchema.optional(),
  memory_id: IdSchema.optional(),
  kind: z.enum(KNOWLEDGE_KINDS).optional(),
  trust: z.enum(TRUST_LEVELS).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SEARCH_LIMIT_MAX)
    .default(SEARCH_LIMIT_DEFAULT),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** `POST /api/v1/memories`: a person adds an Inbox or a Notebook. About me is made at sign-in. */
export const MemoryCreateRequestSchema = z.strictObject({
  workspace_id: IdSchema.optional(),
  layer: z.enum(["long", "short"]),
  name: memoryName,
});
export type MemoryCreateRequest = z.infer<typeof MemoryCreateRequestSchema>;

/** `GET /api/v1/memories?workspace_id=`. */
export const MemoriesListQuerySchema = z.strictObject({
  workspace_id: IdSchema.optional(),
});

export interface Memory {
  id: string;
  workspace_id: string;
  layer: MemoryLayer;
  name: string;
  is_default: boolean;
  created_at: string;
}

/** An entry as the API returns it. `body` and `versions` only on `GET /entries/:id`. */
export interface Entry {
  id: string;
  seq: number;
  workspace_id: string;
  memory_id: string;
  layer: MemoryLayer;
  kind: KnowledgeKind;
  topic: EntryTopic | null;
  trust: TrustLevel;
  title: string;
  summary: string;
  summary_source: SummarySource;
  questions: string[];
  refs: string[];
  version: number;
  author_kind: AuthorKind;
  author: string;
  on_behalf_of: string;
  source: EntrySource;
  quarantined_because: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  body?: string;
}

export interface EntryVersion {
  version: number;
  kind: KnowledgeKind;
  topic: EntryTopic | null;
  title: string;
  body: string;
  summary: string;
  summary_source: SummarySource;
  author_kind: AuthorKind;
  author: string;
  created_at: string;
}

/** The fallback summary: the title, then the body's start cut at a sentence or a word. */
export function fallbackSummary(entryTitle: string, entryBody: string): string {
  const flat = entryBody.replace(/\s+/g, " ").trim();
  let cut = flat.slice(0, FALLBACK_SUMMARY_CHARS);
  if (flat.length > FALLBACK_SUMMARY_CHARS) {
    const sentence = cut.lastIndexOf(". ");
    const word = cut.lastIndexOf(" ");
    cut =
      sentence > 100
        ? cut.slice(0, sentence + 1)
        : cut.slice(0, word > 0 ? word : cut.length);
  }
  return `${entryTitle.trim()}: ${cut}`.slice(0, MEMORY_CAPS.summary);
}
