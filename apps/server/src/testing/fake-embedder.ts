// A stand-in embedding model for tests (D47): each group of words is one meaning, so "Postgres"
// and "SQL store" land close while sharing no word. Deterministic and offline.
import { EMBEDDING_DIMS } from "@sky-brain/shared/memory";
import type { Embedder } from "@sky-brain/memory/embed/embedder";
import type { Background, Semantic } from "@sky-brain/memory/embed/semantic";

export interface FakeEmbedder extends Embedder {
  /** Every text sent, with its input type. */
  calls: { texts: string[]; input: string }[];
  /** When set, every call throws (a provider outage). */
  failing: boolean;
}

export function conceptEmbedder(
  groups: string[][],
  model = "fake/concepts",
): FakeEmbedder {
  const dimOf = new Map<string, number>();
  groups.forEach((words, i) => {
    for (const w of words) dimOf.set(w.toLowerCase(), i);
  });
  const fake: FakeEmbedder = {
    model,
    calls: [],
    failing: false,
    embed(texts, input) {
      fake.calls.push({ texts, input });
      if (fake.failing) return Promise.reject(new Error("provider down"));
      return Promise.resolve(
        texts.map((t) => {
          const v = new Array<number>(EMBEDDING_DIMS).fill(0);
          // The last dimension is "anything else", so no vector is all zeros.
          v[EMBEDDING_DIMS - 1] = 0.05;
          for (const word of t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
            const d = dimOf.get(word);
            if (d !== undefined) v[d]! += 1;
          }
          const norm = Math.hypot(...v);
          return v.map((x) => x / norm);
        }),
      );
    },
  };
  return fake;
}

/** A Semantic whose background tasks the test awaits with `settle()`. */
export function testSemantic(embedder: Embedder): Semantic & {
  settle(): Promise<void>;
} {
  const pending: Promise<unknown>[] = [];
  const background: Background = (task) => {
    pending.push(task);
  };
  return {
    embedder,
    background,
    async settle() {
      while (pending.length) await pending.shift();
    },
  };
}
