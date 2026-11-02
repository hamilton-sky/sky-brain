import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type AppOptions } from "./app.ts";
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

interface RawResponse {
  status: number;
  body: any;
}

/** A request with headers fetch will not send as given (Host), over node:http. */
function raw(
  url: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${url}${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) }),
        );
      },
    );
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

function listenWith(
  options: Omit<AppOptions, "db">,
): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const app = createApp({ db, resolveActor, ...options });
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const alice = JSON.stringify({ kind: "human", user_id: "alice" });

describe("app with the dev actor header on (pnpm dev)", () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await listenWith({ devActorHeader: true }));
  });

  afterAll(async () => {
    await close(server);
  });

  it("refuses X-Dev-Actor when only X-Forwarded-Host names localhost", async () => {
    const res = await raw(url, "/api/v1/nothing-here", {
      Host: "rebound.example",
      "X-Forwarded-Host": "localhost",
      "X-Dev-Actor": alice,
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("dev_actor_disabled");
  });

  it("still honours X-Dev-Actor for a request addressed to localhost", async () => {
    const port = new URL(url).port;
    const res = await raw(url, "/api/v1/nothing-here", {
      Host: `localhost:${port}`,
      "X-Dev-Actor": alice,
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("does not let a caller pick its rate-limit bucket with X-Forwarded-For", async () => {
    for (let i = 1; i <= 60; i += 1) {
      const res = await raw(
        url,
        "/api/device/code",
        { "X-Forwarded-For": `203.0.113.${i}` },
        { client_name: "dev" },
      );
      expect(res.status).toBe(200);
    }
    const over = await raw(
      url,
      "/api/device/code",
      { "X-Forwarded-For": "203.0.113.200" },
      { client_name: "dev" },
    );
    expect(over).toEqual({ status: 429, body: { error: "rate_limited" } });
  });
});

describe("createApp options", () => {
  it("refuses to trust a proxy while the dev actor header is on", () => {
    expect(() =>
      createApp({ db, devActorHeader: true, trustProxyHops: 1 }),
    ).toThrow(/trustProxyHops/);
  });

  it("refuses a negative or fractional proxy hop count", () => {
    expect(() => createApp({ db, trustProxyHops: -1 })).toThrow(
      /trustProxyHops/,
    );
    expect(() => createApp({ db, trustProxyHops: 1.5 })).toThrow(
      /trustProxyHops/,
    );
  });

  it("refuses a public base URL that is not a bare http(s) origin", () => {
    for (const bad of [
      "not a url",
      "ftp://brain.example",
      "https://brain.example/app",
      "https://brain.example?x=1",
    ]) {
      expect(() => createApp({ db, publicBaseUrl: bad })).toThrow(
        /publicBaseUrl/,
      );
    }
  });

  it("builds verification_uri from the public base URL, whatever Host the caller sends", async () => {
    const { server, url } = await listenWith({
      publicBaseUrl: "https://brain.example/",
    });
    try {
      const res = await raw(
        url,
        "/api/device/code",
        {
          Host: "evil.example",
          "X-Forwarded-Host": "evil.example",
          "X-Forwarded-Proto": "http",
        },
        { client_name: "pathly" },
      );
      expect(res.status).toBe(200);
      expect(res.body.verification_uri).toBe(
        "https://brain.example/devices/approve",
      );
    } finally {
      await close(server);
    }
  });

  it("trusts as many proxy hops as it is told", async () => {
    const { server, url } = await listenWith({ trustProxyHops: 2 });
    try {
      // Two trusted hops: the socket's peer and the last X-Forwarded-For entry are proxies, so the
      // client is the second entry from the right and the caller-sent leftmost one never counts.
      for (let i = 1; i <= 60; i += 1) {
        const res = await raw(
          url,
          "/api/device/code",
          { "X-Forwarded-For": `192.0.2.${i}, 198.51.100.9, 10.0.0.1` },
          { client_name: "pathly" },
        );
        expect(res.status).toBe(200);
      }
      const over = await raw(
        url,
        "/api/device/code",
        { "X-Forwarded-For": "192.0.2.250, 198.51.100.9, 10.0.0.1" },
        { client_name: "pathly" },
      );
      expect(over.status).toBe(429);
    } finally {
      await close(server);
    }
  });
});
