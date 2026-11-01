// startTestServer: the shapes of spec.md Interfaces -> How a test reaches the server.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeTestDb,
  createTestDb,
  startTestServer,
  type Db,
  type TestServer,
} from "./harness.ts";

let db: Db;
let webDist: string;
let server: TestServer;

beforeAll(async () => {
  db = await createTestDb();
  webDist = await mkdtemp(join(tmpdir(), "sky-brain-harness-"));
  await writeFile(join(webDist, "index.html"), "<title>shell</title>");
  server = await startTestServer({ db, webDist });
}, 60_000);

afterAll(async () => {
  await server?.close();
  if (db) await closeTestDb(db);
  if (webDist) await rm(webDist, { recursive: true, force: true });
}, 60_000);

describe("startTestServer", () => {
  it("listens on 127.0.0.1", () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("parses a JSON body and keeps the text and headers", async () => {
    const res = await server.anonymous.get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.text).toBe('{"ok":true}');
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("leaves body null for a response that is not JSON", async () => {
    const res = await server.anonymous.get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<title>shell</title>");
    expect(res.body).toBeNull();
  });

  it("carries the actor of as() and none for anonymous", async () => {
    const actor = { kind: "human", user_id: "alice" } as const;
    expect((await server.as(actor).get("/api/v1/x")).status).toBe(404);
    expect((await server.anonymous.get("/api/v1/x")).status).toBe(401);
  });

  it("carries the actor alongside extra headers of request()", async () => {
    const actor = { kind: "human", user_id: "alice" } as const;
    const res = await server.as(actor).request("/api/v1/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_json");
  });

  it("sends post and delete bodies as JSON", async () => {
    const actor = { kind: "human", user_id: "alice" } as const;
    const big = { body: "x".repeat(70 * 1024) };
    expect((await server.as(actor).post("/api/v1/x", big)).status).toBe(413);
    expect((await server.as(actor).delete("/api/v1/x", big)).status).toBe(413);
    expect((await server.as(actor).delete("/api/v1/x")).status).toBe(404);
  });
});
