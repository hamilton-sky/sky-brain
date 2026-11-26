// RRF and the HTTP embedder (D47), without a database or a network.
import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMS } from "@sky-brain/shared/memory";
import { embedderFromEnv, httpEmbedder } from "./embedder.ts";
import { fuseRrf } from "./rrf.ts";

describe("fuseRrf", () => {
  it("ranks an item found by both lists above items found by one", () => {
    const fused = fuseRrf(
      [
        ["a", "b", "c"],
        ["d", "b", "e"],
      ],
      (x) => x,
    );
    expect(fused[0]!.item).toBe("b");
    expect(fused[0]!.score).toBeCloseTo(2 / 62);
    expect(fused.map((f) => f.item)).toEqual(["b", "a", "d", "c", "e"]);
  });

  it("keeps a single list's order", () => {
    expect(fuseRrf([["x", "y"]], (v) => v).map((f) => f.item)).toEqual([
      "x",
      "y",
    ]);
  });
});

function fakeFetch(dims = EMBEDDING_DIMS, status = 200) {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = ((url: string, init: RequestInit) => {
    seen.push({ url, init });
    const body = JSON.parse(init.body as string) as { input: string[] };
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: body.input
            .map((_, index) => ({
              index,
              embedding: new Array(dims).fill(0.1),
            }))
            .reverse(),
        }),
        { status },
      ),
    );
  }) as unknown as typeof fetch;
  return { f, seen };
}

describe("httpEmbedder", () => {
  it("asks Voyage for 1024 numbers with the input type, key in the header", async () => {
    const { f, seen } = fakeFetch();
    const e = httpEmbedder({ provider: "voyage", apiKey: "k", fetch: f });
    const out = await e.embed(["one", "two"], "query");
    expect(out).toHaveLength(2);
    expect(e.model).toBe("voyage/voyage-4-lite");
    expect(seen[0]!.url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({
      model: "voyage-4-lite",
      input: ["one", "two"],
      input_type: "query",
      output_dimension: EMBEDDING_DIMS,
    });
    expect(new Headers(seen[0]!.init.headers).get("authorization")).toBe(
      "Bearer k",
    );
    expect(seen[0]!.url).not.toContain("k=");
  });

  it("asks an OpenAI-compatible API for 1024 dimensions", async () => {
    const { f, seen } = fakeFetch();
    const e = httpEmbedder({ provider: "openai", apiKey: "k", fetch: f });
    await e.embed(["one"], "document");
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({
      model: "text-embedding-3-small",
      input: ["one"],
      dimensions: EMBEDDING_DIMS,
    });
  });

  it("refuses vectors of the wrong length and failed requests", async () => {
    const short = httpEmbedder({
      provider: "voyage",
      apiKey: "k",
      fetch: fakeFetch(512).f,
    });
    await expect(short.embed(["a"], "query")).rejects.toThrow(/1024/);
    const down = httpEmbedder({
      provider: "voyage",
      apiKey: "k",
      fetch: fakeFetch(EMBEDDING_DIMS, 500).f,
    });
    await expect(down.embed(["a"], "query")).rejects.toThrow(/HTTP 500/);
  });

  it("is off without a key and refuses an unknown provider", () => {
    expect(embedderFromEnv({})).toBeUndefined();
    expect(() =>
      embedderFromEnv({ EMBEDDINGS_API_KEY: "k", EMBEDDINGS_PROVIDER: "x" }),
    ).toThrow(/voyage, openai/);
  });
});
