// How the routes use the embedder (D47): a query's vector is asked for inline, with a timeout,
// and a failure falls back to words alone; entry vectors are made after the answer is sent
// (Vercel's waitUntil, or a plain promise in Node), so a slow or down provider never fails a
// write or a search.
import type { Db } from "@sky-brain/db/client";
import type { Embedder } from "./embedder.ts";
import { refreshVectors } from "./entry-vectors.ts";

/** Runs a task after the response; on Vercel this is `waitUntil`. */
export type Background = (task: Promise<unknown>) => void;

export interface Semantic {
  embedder?: Embedder | undefined;
  background?: Background | undefined;
}

const runAndForget: Background = (task) => {
  void task;
};

/**
 * How a search was matched, returned with its results so the person and the agent can tell
 * (D47): `hybrid` (words and meaning), or `words` with the reason. The reason names the
 * provider's HTTP status at most, never the key or the text.
 */
export type Match = { mode: "hybrid" } | { mode: "words"; reason: WordsReason };
/** `embeddings_off`, `no_query`, or `provider_error: <message>`. */
type WordsReason = string;

/** The query's vector and how the search will match; words only when embeddings are off or fail. */
export async function queryEmbedding(
  semantic: Semantic,
  q: string | undefined,
): Promise<{ vector?: number[]; match: Match }> {
  if (q === undefined) return { match: { mode: "words", reason: "no_query" } };
  if (!semantic.embedder) {
    return { match: { mode: "words", reason: "embeddings_off" } };
  }
  try {
    const [vector] = await semantic.embedder.embed([q], "query");
    return { vector: vector!, match: { mode: "hybrid" } };
  } catch (err) {
    const why = errorText(err);
    console.error("query embedding failed; searching words only:", why);
    return { match: { mode: "words", reason: `provider_error: ${why}` } };
  }
}

/** The query's vector, or undefined when embeddings are off or the provider fails. */
export async function queryVector(
  semantic: Semantic,
  q: string | undefined,
): Promise<number[] | undefined> {
  return (await queryEmbedding(semantic, q)).vector;
}

/** Makes missing or stale vectors in this workspace after the response. */
export function refreshLater(
  semantic: Semantic,
  db: Db,
  workspaceId: string | undefined,
): void {
  const embedder = semantic.embedder;
  if (!embedder) return;
  const task = refreshVectors(
    db,
    embedder,
    workspaceId ? { workspaceId } : {},
  ).catch((err: unknown) => {
    console.error("entry embedding failed; will retry:", errorText(err));
  });
  (semantic.background ?? runAndForget)(task);
}

/** The error's message only: never the text that was sent. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}
