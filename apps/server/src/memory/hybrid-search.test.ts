// Hybrid search (D47, BUILD-PLAN step 4): the server embeds each entry's title, summary and
// questions after the write, and `search` and `context` fuse word hits with vector hits (RRF).
// Vector hits pass the same read rules as words: another brain, About me of someone else,
// quarantined and rejected entries never come back. A provider outage falls back to words.
import type { Actor } from "@sky-brain/shared/actor";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entryVectors, hats, memories } from "@sky-brain/db/schema";
import * as harness from "../testing/harness.ts";
import {
  alice,
  aliceAgent,
  bob,
  seedTwoBrains,
} from "../testing/two-brains.ts";
import { conceptEmbedder, testSemantic } from "../testing/fake-embedder.ts";

let db: harness.Db;
let server: harness.TestServer;
let wsA: string;

const embedder = conceptEmbedder([
  ["postgres", "database", "sql", "store", "pgvector"],
  ["recipe", "recipes", "cooking", "kitchen"],
  ["site", "website", "web"],
  ["hosting", "vercel", "deploy", "server"],
]);
const semantic = testSemantic(embedder);

async function memoryId(as: Actor, layer: string) {
  const res = await server.as(as).get("/api/v1/memories");
  return (res.body.memories as { id: string; layer: string }[]).find(
    (m) => m.layer === layer,
  )!.id;
}

async function write(as: Actor, layer: string, title: string, body: string) {
  const res = await server.as(as).post("/api/v1/entries", {
    kind: "fact",
    memory_id: await memoryId(as, layer),
    title,
    body,
    summary: title,
  });
  expect(res.status).toBe(201);
  await semantic.settle();
  return res.body.entry as { id: string; version: number };
}

const titles = (res: harness.TestResponse) =>
  (res.body.entries as { title: string }[]).map((e) => e.title);

// Shares no word with "Recipe site database is Postgres".
const MEANING_ONLY = "which SQL store does the cooking website use";

beforeAll(async () => {
  db = await harness.createTestDb();
  wsA = await seedTwoBrains(db);
  server = await harness.startTestServer({
    db,
    now: () => new Date("2026-11-26T12:00:00Z"),
    semantic,
  });
  await write(
    alice,
    "long",
    "Recipe site database is Postgres",
    "Relational data.",
  );
  await write(alice, "long", "Hosting is on Vercel", "Express runs there.");
  await write(bob, "long", "Bob's recipe site uses a Postgres database", "x");
}, 60_000);

afterAll(async () => {
  await server.close();
  await harness.closeTestDb(db);
});

describe("hybrid search", () => {
  it("stores one vector per entry, of its title, summary and questions", async () => {
    const rows = await db.select().from(entryVectors);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.model === "fake/concepts")).toBe(true);
    const docs = embedder.calls.filter((c) => c.input === "document");
    expect(docs.flatMap((c) => c.texts)).toContain(
      "Recipe site database is Postgres\nRecipe site database is Postgres",
    );
  });

  it("finds by meaning what word search misses", async () => {
    const q = encodeURIComponent(MEANING_ONLY);
    const res = await server.as(alice).get(`/api/v1/entries?q=${q}`);
    expect(res.status).toBe(200);
    expect(titles(res)[0]).toBe("Recipe site database is Postgres");
  });

  it("never returns another brain's entries through vectors (rule 4)", async () => {
    const q = encodeURIComponent(MEANING_ONLY);
    for (const as of [alice, aliceAgent]) {
      const res = await server.as(as).get(`/api/v1/entries?q=${q}`);
      expect(titles(res)).not.toContain(
        "Bob's recipe site uses a Postgres database",
      );
    }
    const asBob = await server.as(bob).get(`/api/v1/entries?q=${q}`);
    expect(titles(asBob)).toEqual([
      "Bob's recipe site uses a Postgres database",
    ]);
  });

  it("hides rejected entries from vector hits too", async () => {
    const e = await write(alice, "long", "Old kitchen database idea", "y");
    const rej = await server.as(alice).post(`/api/v1/entries/${e.id}/reject`);
    expect(rej.status).toBe(200);
    const q = encodeURIComponent("kitchen SQL");
    for (const as of [alice, aliceAgent]) {
      const res = await server.as(as).get(`/api/v1/entries?q=${q}`);
      expect(titles(res)).not.toContain("Old kitchen database idea");
    }
  });

  it("makes the vector again after a new version", async () => {
    const e = await write(alice, "long", "Deploy notes", "z");
    const rev = await server
      .as(alice)
      .post(`/api/v1/entries/${e.id}/versions`, {
        title: "Deploy notes for the recipe website",
        summary: "Deploy notes for the recipe website",
      });
    expect(rev.status).toBe(201);
    await semantic.settle();
    const [row] = await db
      .select()
      .from(entryVectors)
      .where(eq(entryVectors.entryId, e.id));
    expect(row!.version).toBe(2);
  });

  it("falls back to words when the provider is down", async () => {
    embedder.failing = true;
    try {
      const res = await server.as(alice).get("/api/v1/entries?q=Vercel");
      expect(res.status).toBe(200);
      expect(titles(res)).toEqual(["Hosting is on Vercel"]);
      const miss = await server
        .as(alice)
        .get(`/api/v1/entries?q=${encodeURIComponent(MEANING_ONLY)}`);
      expect(miss.status).toBe(200);
      expect(titles(miss)).not.toContain("Recipe site database is Postgres");
      await semantic.settle();
    } finally {
      embedder.failing = false;
    }
  });

  it("feeds the context packet by meaning", async () => {
    const q = encodeURIComponent(MEANING_ONLY);
    const res = await server
      .as(aliceAgent)
      .get(`/api/v1/entries/context?q=${q}`);
    expect(res.status).toBe(200);
    const relevant = res.body.context.relevant as { title: string }[];
    expect(relevant.map((r) => r.title)).toContain(
      "Recipe site database is Postgres",
    );
    expect(JSON.stringify(res.body)).not.toContain("Bob's");
    expect(wsA).toBeTruthy();
  });

  it("narrows vector hits to the hat the agent wears (D44)", async () => {
    const [work, home] = await db
      .insert(hats)
      .values([
        { workspaceId: wsA, slug: "work", name: "Work" },
        { workspaceId: wsA, slug: "home", name: "Home" },
      ])
      .returning();
    const [homeBook] = await db
      .insert(memories)
      .values({
        workspaceId: wsA,
        layer: "long",
        name: "Home",
        hatId: home!.id,
      })
      .returning();
    const res = await server.as(alice).post("/api/v1/entries", {
      kind: "fact",
      memory_id: homeBook!.id,
      title: "Family kitchen recipes live in pgvector",
      body: "z",
      summary: "Family kitchen recipes live in pgvector",
    });
    expect(res.status).toBe(201);
    await semantic.settle();
    const q = encodeURIComponent("cooking SQL store");
    const wearing = (hat: typeof work): Actor =>
      ({
        ...aliceAgent,
        hat: { id: hat!.id, slug: hat!.slug, name: hat!.name },
      }) as Actor;
    const atWork = await server.as(wearing(work)).get(`/api/v1/entries?q=${q}`);
    expect(titles(atWork)).not.toContain(
      "Family kitchen recipes live in pgvector",
    );
    expect(titles(atWork)).toContain("Recipe site database is Postgres");
    const atHome = await server.as(wearing(home)).get(`/api/v1/entries?q=${q}`);
    expect(titles(atHome)).toContain("Family kitchen recipes live in pgvector");
  });
});
