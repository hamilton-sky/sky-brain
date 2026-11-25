// Cross-layer reads (BOOK.md 11 step 1): search narrowed to one layer, and the context packet
// for a free question, `GET /entries/context?q=`. Allowed for the brain's owner and their agent;
// another person's brain answers 404.
import type { Actor } from "@sky-brain/shared/actor";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as harness from "../testing/harness.ts";

let db: harness.Db;
let server: harness.TestServer;
let wsA: string;

const alice: Actor = { kind: "human", user_id: "alice" };
const aliceAgent: Actor = {
  kind: "agent",
  agent_id: "mcp/claude.ai",
  on_behalf_of: "alice",
};
const bob: Actor = { kind: "human", user_id: "bob" };

async function memoryId(layer: string) {
  const res = await server.as(alice).get("/api/v1/memories");
  return (res.body.memories as { id: string; layer: string }[]).find(
    (m) => m.layer === layer,
  )!.id;
}

beforeAll(async () => {
  db = await harness.createTestDb();
  wsA = (
    await harness.seedWorkspace(db, {
      name: "a",
      members: [{ userId: "alice", role: "owner" }],
    })
  ).id;
  await harness.seedWorkspace(db, {
    name: "b",
    members: [{ userId: "bob", role: "owner" }],
  });
  server = await harness.startTestServer({
    db,
    now: () => new Date("2026-11-25T12:00:00Z"),
  });
  const write = (memory: string, title: string, body: string) =>
    server.as(alice).post("/api/v1/entries", {
      kind: "fact",
      memory_id: memory,
      title,
      body,
      summary: title,
    });
  expect(
    (
      await write(
        await memoryId("core"),
        "I use metric units",
        "Recipes in grams and Celsius, always metric.",
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await write(
        await memoryId("long"),
        "Recipe site database is Postgres",
        "The recipe site moved to Postgres because recipe data is relational.",
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await write(
        await memoryId("short"),
        "Recipe site idea",
        "Maybe the recipe site needs a dark mode.",
      )
    ).status,
  ).toBe(201);
}, 60_000);

afterAll(async () => {
  if (server) await server.close();
  if (db) await harness.closeTestDb(db);
});

describe("search by layer", () => {
  it("returns only the named layer", async () => {
    const all = await server.as(alice).get("/api/v1/entries?q=recipe");
    expect(all.status).toBe(200);
    expect(all.body.entries.length).toBeGreaterThanOrEqual(2);
    const long = await server
      .as(alice)
      .get("/api/v1/entries?q=recipe&layer=long");
    expect(long.status).toBe(200);
    expect(long.body.entries.length).toBeGreaterThan(0);
    for (const e of long.body.entries as { layer: string }[])
      expect(e.layer).toBe("long");
  });

  it("refuses an unknown layer", async () => {
    const res = await server
      .as(alice)
      .get("/api/v1/entries?q=recipe&layer=deep");
    expect(res.status).toBe(400);
  });
});

describe("context for a question", () => {
  it("gives the owner About me and the relevant entries from every layer", async () => {
    const res = await server
      .as(alice)
      .get("/api/v1/entries/context?q=recipe%20site%20database");
    expect(res.status).toBe(200);
    const ctx = res.body.context;
    expect(ctx.about_me.length).toBeGreaterThan(0);
    expect(ctx.text).toMatch(/metric/);
    expect(ctx.text).toMatch(/Postgres/);
  });

  it("gives the owner's agent the same packet", async () => {
    const res = await server
      .as(aliceAgent)
      .get("/api/v1/entries/context?q=recipe%20site");
    expect(res.status).toBe(200);
    expect(res.body.context.about_me.length).toBeGreaterThan(0);
  });

  it("refuses an empty question", async () => {
    const res = await server.as(alice).get("/api/v1/entries/context?q=");
    expect(res.status).toBe(400);
  });

  it("another person's brain answers 404", async () => {
    const res = await server
      .as(bob)
      .get(`/api/v1/entries/context?q=recipe&workspace_id=${wsA}`);
    expect(res.status).toBe(404);
  });

  it("another person's own context does not hold this brain's entries", async () => {
    const res = await server
      .as(bob)
      .get("/api/v1/entries/context?q=recipe%20site%20database");
    expect(res.status).toBe(200);
    expect(res.body.context.text).not.toMatch(/Postgres|metric/);
  });
});
