// Embedders for the benchmark's vector and hybrid modes (D44).
//
//   --embed voyage | openai   the server's own HTTP embedder (EMBEDDINGS_API_KEY, as on Vercel)
//   --embed local             an ONNX model on this machine through transformers.js, for runs
//                             without a key: EMBED_MODEL_DIR holds <name>/onnx/model_quantized.onnx
//                             with its tokenizer, TRANSFORMERS_JS points at @huggingface/transformers
//                             (not a dependency of the repo; install it outside). Built for the
//                             e5 family, which wants "query: " and "passage: " in front.
//
// Vectors are cached in bench/.cache by model and text, so a second run costs nothing.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const CACHE = join(import.meta.dirname, ".cache");

async function localEmbedder() {
  const dir = process.env.EMBED_MODEL_DIR;
  if (!dir)
    throw new Error("--embed local needs EMBED_MODEL_DIR=<folder>/<model>");
  const lib = process.env.TRANSFORMERS_JS
    ? pathToFileURL(process.env.TRANSFORMERS_JS).href
    : "@huggingface/transformers";
  const { env, pipeline } = await import(lib);
  env.allowRemoteModels = false;
  env.localModelPath = join(dir, "..") + "/";
  const name = basename(dir);
  const extract = await pipeline("feature-extraction", name, { dtype: "q8" });
  return {
    model: `local/${name}`,
    async embed(texts, input) {
      const prefix = input === "query" ? "query: " : "passage: ";
      const out = await extract(
        texts.map((t) => prefix + t),
        { pooling: "mean", normalize: true },
      );
      return out.tolist();
    },
  };
}

async function httpEmbedderFromEnv(provider) {
  const { embedderFromEnv } =
    await import("../packages/memory/src/embed/embedder.ts");
  const e = embedderFromEnv({ ...process.env, EMBEDDINGS_PROVIDER: provider });
  if (!e) throw new Error(`--embed ${provider} needs EMBEDDINGS_API_KEY`);
  return e;
}

/** The embedder named by --embed, wrapped with the cache and batching. */
export async function benchEmbedder(name) {
  const inner =
    name === "local" ? await localEmbedder() : await httpEmbedderFromEnv(name);
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${inner.model.replaceAll("/", "_")}.json`);
  const cache = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const keyOf = (t, input) =>
    createHash("sha256").update(`${input}\n${t}`).digest("hex").slice(0, 32);
  return {
    model: inner.model,
    async embed(texts, input, batch = 16) {
      const missing = [
        ...new Set(texts.filter((t) => !cache[keyOf(t, input)])),
      ];
      for (let i = 0; i < missing.length; i += batch) {
        const part = missing.slice(i, i + batch);
        const vecs = await inner.embed(part, input);
        part.forEach((t, j) => (cache[keyOf(t, input)] = vecs[j]));
        if (missing.length > batch) {
          process.stderr.write(
            `\rembedded ${i + part.length}/${missing.length}`,
          );
        }
      }
      if (missing.length) {
        writeFileSync(file, JSON.stringify(cache));
        if (missing.length > batch) process.stderr.write("\n");
      }
      return texts.map((t) => cache[keyOf(t, input)]);
    },
  };
}
