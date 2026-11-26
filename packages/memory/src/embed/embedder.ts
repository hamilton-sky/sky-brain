// The server's embedding model (D47): the one model sky-brain calls itself (BUILD-PLAN step 4).
// It turns an entry's title, summary and questions, or a search query, into EMBEDDING_DIMS
// numbers. Off when no key is set: search then runs on words alone, as before.
import { EMBEDDING_DIMS } from "@sky-brain/shared/memory";

/** `document` for what is stored, `query` for what is asked: models embed the two differently. */
export type EmbedInput = "document" | "query";

export interface Embedder {
  /** Stored with every vector, so a change of model can find the vectors to make again. */
  readonly model: string;
  embed(texts: string[], input: EmbedInput): Promise<number[][]>;
}

export const EMBED_TIMEOUT_MS = 4_000;

interface ProviderSpec {
  url: string;
  defaultModel: string;
  body: (model: string, texts: string[], input: EmbedInput) => object;
}

// Voyage: voyage-4-lite is multilingual (Hebrew and English) and 1024 by default.
// OpenAI-compatible: OpenAI itself, or a gateway such as Vercel AI Gateway (EMBEDDINGS_URL).
const PROVIDERS: Record<string, ProviderSpec> = {
  voyage: {
    url: "https://api.voyageai.com/v1/embeddings",
    defaultModel: "voyage-4-lite",
    body: (model, input, kind) => ({
      model,
      input,
      input_type: kind,
      output_dimension: EMBEDDING_DIMS,
    }),
  },
  openai: {
    url: "https://api.openai.com/v1/embeddings",
    defaultModel: "text-embedding-3-small",
    body: (model, input) => ({ model, input, dimensions: EMBEDDING_DIMS }),
  },
};

export interface HttpEmbedderOptions {
  provider: string;
  apiKey: string;
  model?: string;
  url?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** An embedder over a provider's HTTP API. Never logs the key or the text. */
export function httpEmbedder(options: HttpEmbedderOptions): Embedder {
  const spec = PROVIDERS[options.provider];
  if (!spec) {
    throw new Error(
      `EMBEDDINGS_PROVIDER must be one of ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  const model = options.model ?? spec.defaultModel;
  const url = options.url ?? spec.url;
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? EMBED_TIMEOUT_MS;
  return {
    model: `${options.provider}/${model}`,
    async embed(texts, input) {
      if (texts.length === 0) return [];
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(spec.body(model, texts, input)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        throw new Error(`embedding request failed: HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        data?: { index: number; embedding: number[] }[];
      };
      const data = [...(json.data ?? [])].sort((a, b) => a.index - b.index);
      if (
        data.length !== texts.length ||
        data.some((d) => d.embedding.length !== EMBEDDING_DIMS)
      ) {
        throw new Error(
          `embedding response must hold ${texts.length} vectors of ${EMBEDDING_DIMS}`,
        );
      }
      return data.map((d) => d.embedding);
    },
  };
}

/**
 * `EMBEDDINGS_PROVIDER` (voyage or openai) and `EMBEDDINGS_API_KEY` turn embeddings on;
 * `EMBEDDINGS_MODEL` and `EMBEDDINGS_URL` are optional. Without a key there is no embedder.
 */
export function embedderFromEnv(
  env: Record<string, string | undefined>,
): Embedder | undefined {
  const apiKey = env.EMBEDDINGS_API_KEY;
  if (!apiKey) return undefined;
  return httpEmbedder({
    provider: env.EMBEDDINGS_PROVIDER || "voyage",
    apiKey,
    ...(env.EMBEDDINGS_MODEL ? { model: env.EMBEDDINGS_MODEL } : {}),
    ...(env.EMBEDDINGS_URL ? { url: env.EMBEDDINGS_URL } : {}),
  });
}
