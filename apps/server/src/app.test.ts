import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { closeTestDb, createTestDb, type Db } from "./testing/harness.ts";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  if (db) await closeTestDb(db);
}, 60_000);

// `Bearer alice` is the human alice; anything else is no actor.
const resolveActor = (req: { get(name: string): string | undefined }) =>
  req.get("authorization") === "Bearer alice"
    ? { kind: "human" as const, user_id: "alice" }
    : undefined;

function listen(webDist: string): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const app = createApp({ db, resolveActor, webDist });
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe("app with a web build", () => {
  let webDist: string;
  let server: Server;
  let url: string;

  beforeAll(async () => {
    webDist = await mkdtemp(join(tmpdir(), "sky-brain-web-"));
    await writeFile(
      join(webDist, "index.html"),
      "<!doctype html><title>shell</title>",
    );
    ({ server, url } = await listen(webDist));
  });

  afterAll(async () => {
    await close(server);
    await rm(webDist, { recursive: true, force: true });
  });

  it("GET /healthz answers 200", async () => {
    const res = await fetch(`${url}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET / serves the web build", async () => {
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>shell</title>");
  });

  it("GET of another page falls back to index.html", async () => {
    const res = await fetch(`${url}/workspaces/abc`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>shell</title>");
  });

  it("unknown /api/v1 path with an actor answers 404 JSON", async () => {
    const res = await fetch(`${url}/api/v1/nothing-here`, {
      headers: { authorization: "Bearer alice" },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("unknown /api/v1 path without an actor answers 401 JSON", async () => {
    const res = await fetch(`${url}/api/v1/nothing-here`);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error.code).toBe("unauthenticated");
  });

  it("GET /healthz needs no actor", async () => {
    const res = await fetch(`${url}/healthz`, {
      headers: { "X-Dev-Actor": "ignored here" },
    });
    expect(res.status).toBe(200);
  });
});

describe("app without a web build", () => {
  let webDist: string;
  let server: Server;
  let url: string;

  beforeAll(async () => {
    webDist = join(tmpdir(), `sky-brain-missing-${process.pid}-${Date.now()}`);
    ({ server, url } = await listen(webDist));
  });

  afterAll(async () => {
    await close(server);
  });

  it("GET / answers a plain 404 when the build is missing", async () => {
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
