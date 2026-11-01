import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

function listen(webDist: string): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createApp({ webDist }).listen(0, "127.0.0.1", () => {
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

  it("unknown /api path answers 404 JSON", async () => {
    const res = await fetch(`${url}/api/v1/nothing-here`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
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
