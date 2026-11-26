// `/api/v1/book` (D46): the person's Book page reads the same book the agents read, with
// "Your brain now" from the caller's own workspaces only (hard rule 4).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeTestDb,
  createTestDb,
  seedProject,
  seedWorkspace,
  startTestServer,
  type Db,
  type TestServer,
} from "../testing/harness.ts";

let db: Db;
let server: TestServer;
const ann = { kind: "human" as const, user_id: "ann" };

beforeAll(async () => {
  db = await createTestDb();
  server = await startTestServer({ db });
  const a = await seedWorkspace(db, {
    name: "A",
    members: [{ userId: "ann", role: "owner" }],
  });
  const b = await seedWorkspace(db, {
    name: "B",
    members: [{ userId: "bob", role: "owner" }],
  });
  await seedProject(db, { workspaceId: a.id, slug: "garden", name: "Garden" });
  await seedProject(db, { workspaceId: b.id, slug: "secret", name: "Secret" });
}, 60_000);

afterAll(async () => {
  if (server) await server.close();
  if (db) await closeTestDb(db);
});

describe("the book page", () => {
  it("the contents carry the chapters and the caller's own boards, not another workspace's", async () => {
    const res = await server.as(ann).get("/api/v1/book");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("contents");
    expect(res.body.markdown).toContain("## Your brain now");
    expect(res.body.markdown).toContain("Garden: 0 goals approved");
    expect(res.body.markdown).not.toContain("Secret");
    expect(res.body.markdown).toContain("**yourself via the web app**");
    const ids = res.body.chapters.map((c: { id: string }) => c.id);
    expect(ids.slice(0, 3)).toEqual(["contents", "start-here", "about-me"]);
    expect(res.body.chapters[1].title).toBe("Start here");
  });

  it("one chapter by id; an unknown id is 404; signed out is 401", async () => {
    const board = await server.as(ann).get("/api/v1/book/board");
    expect(board.status).toBe(200);
    expect(board.body.markdown).toMatch(/^# 5\. Layer: Board/);
    expect((await server.as(ann).get("/api/v1/book/nope")).status).toBe(404);
    expect((await server.anonymous.get("/api/v1/book")).status).toBe(401);
  });
});
