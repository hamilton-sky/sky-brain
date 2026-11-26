// How the routes use the embedder (D44): a query's vector is asked for inline, with a timeout,
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

/** The query's vector, or undefined when embeddings are off or the provider fails. */
export async function queryVector(
  semantic: Semantic,
  q: string | undefined,
): Promise<number[] | undefined> {
  if (!semantic.embedder || q === undefined) return undefined;
  try {
    const [vector] = await semantic.embedder.embed([q], "query");
    return vector;
  } catch (err) {
    console.error(
      "query embedding failed; searching words only:",
      errorText(err),
    );
    return undefined;
  }
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
