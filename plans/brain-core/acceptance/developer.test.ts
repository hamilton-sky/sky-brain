// Story: A developer runs the core on a fresh clone. Also the edge cases about the dev header.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devActorHeaderEnabled } from "../../../apps/server/src/config.ts";
import {
  closeTestDb,
  createTestDb,
  startTestServer,
} from "../../../apps/server/src/testing/harness.ts";
import type { Db, Server } from "./helpers.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

function envWithout(...names: string[]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const n of names) delete env[n];
  return env;
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => ok(port));
    });
  });
}

async function waitForHealthz(url: string, ms: number): Promise<Response> {
  const until = Date.now() + ms;
  let last: unknown;
  while (Date.now() < until) {
    try {
      return await fetch(`${url}/healthz`);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`no answer from ${url}/healthz: ${String(last)}`);
}

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

describe("fresh clone", () => {
  // "`pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` exits 0 on a
  // fresh clone, with no Docker and no database server."
  it("install, lint, typecheck and test exit 0 with no database server", () => {
    expect(existsSync(join(repo, "package.json"))).toBe(true);
    const r = spawnSync(
      "bash",
      [
        "-c",
        "pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test",
      ],
      {
        cwd: repo,
        env: envWithout("DATABASE_URL"),
        encoding: "utf8",
        timeout: 900_000,
      },
    );
    expect({
      status: r.status,
      tail: r.status === 0 ? "" : `${r.stdout}\n${r.stderr}`.slice(-4000),
    }).toEqual({ status: 0, tail: "" });
  }, 960_000);
});

describe("pnpm dev", () => {
  let child: ChildProcess | undefined;
  let url = "";
  let port = 0;

  beforeAll(async () => {
    port = await freePort();
    url = `http://127.0.0.1:${port}`;
    child = spawn("pnpm", ["dev"], {
      cwd: repo,
      detached: true,
      stdio: "ignore",
      env: {
        ...envWithout("DATABASE_URL", "NODE_ENV"),
        PORT: String(port),
        PGLITE_DATA_DIR: "memory://",
      },
    });
  }, 60_000);

  afterAll(() => {
    if (child) killGroup(child);
  });

  // "`pnpm dev` starts one process on one port (`PORT`, default 3000) that answers `GET /healthz`
  // with 200 and `{"ok":true}`, and serves an empty web page at `/`."
  it("answers GET /healthz with 200 {ok:true} and serves a web page at / on PORT", async () => {
    const health = await waitForHealthz(url, 120_000);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    const page = await fetch(`${url}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type") ?? "").toMatch(/text\/html/);
    expect((await page.text()).toLowerCase()).toContain("<html");
  }, 150_000);

  // Edge case: "Dev header on | server listens on 127.0.0.1 only"
  it("listens on 127.0.0.1 only while the dev header is on", async () => {
    await waitForHealthz(url, 120_000);
    const others = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i && i.family === "IPv4" && !i.internal)
      .map((i) => i!.address);
    for (const addr of others) {
      let reached = true;
      try {
        await fetch(`http://${addr}:${port}/healthz`, {
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        reached = false;
      }
      expect({ addr, reached }).toEqual({ addr, reached: false });
    }
  }, 150_000);

  // "Honoured only when the dev header is on (`devActorHeader: true`, which `pnpm dev` sets
  // because `NODE_ENV=development`)" (Interfaces -> Dev actor header)
  it("honours X-Dev-Actor under pnpm dev", async () => {
    await waitForHealthz(url, 120_000);
    const scope = { workspace_id: "00000000-0000-4000-8000-000000000000" };
    const anon = await fetch(`${url}/api/v1/context`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    expect(anon.status).toBe(401);
    const withActor = await fetch(`${url}/api/v1/context`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Dev-Actor": JSON.stringify({ kind: "human", user_id: "u1" }),
      },
      body: JSON.stringify({ scope }),
    });
    // The actor is accepted; the workspace does not exist, so the answer is 404 not_found.
    expect(withActor.status).toBe(404);
    expect(
      ((await withActor.json()) as { error: { code: string } }).error.code,
    ).toBe("not_found");
  }, 150_000);
});

describe("dev smoke", () => {
  // "`node tools/dev-smoke.mjs` starts `pnpm dev`, waits for `/healthz`, prints `healthz 200`,
  // stops it and exits 0."
  it("prints healthz 200 and exits 0", () => {
    const port = 3000 + Math.floor(Math.random() * 1000) + 20000;
    const r = spawnSync("node", ["tools/dev-smoke.mjs"], {
      cwd: repo,
      env: {
        ...envWithout("DATABASE_URL", "NODE_ENV"),
        PORT: String(port),
        PGLITE_DATA_DIR: "memory://",
      },
      encoding: "utf8",
      timeout: 240_000,
    });
    expect(r.stdout ?? "").toContain("healthz 200");
    expect(r.status).toBe(0);
  }, 260_000);
});

describe("CI and render.yaml", () => {
  // "GitHub Actions runs lint, typecheck and test on every push and pull request."
  it("a GitHub Actions workflow runs lint, typecheck and test on push and pull_request", () => {
    const dir = join(repo, ".github", "workflows");
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
    const matching = files.filter((f) => {
      const text = readFileSync(join(dir, f), "utf8");
      return (
        /\bpush\b/.test(text) &&
        /\bpull_request\b/.test(text) &&
        /pnpm (run )?lint\b/.test(text) &&
        /pnpm (run )?typecheck\b/.test(text) &&
        /pnpm (run )?test\b/.test(text)
      );
    });
    expect(matching.length).toBeGreaterThan(0);
  });

  // "`render.yaml` describes one web service with a `/healthz` health check and one Postgres
  // database whose connection string reaches the service as `DATABASE_URL`."
  it("render.yaml has one web service with a /healthz check and a database as DATABASE_URL", () => {
    const file = join(repo, "render.yaml");
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text.match(/type:\s*web\b/g)?.length).toBe(1);
    expect(text).toMatch(/healthCheckPath:\s*["']?\/healthz["']?/);
    expect(text).toMatch(/^databases:/m);
    expect(text).toMatch(/DATABASE_URL/);
    expect(text).toMatch(/fromDatabase:/);
    expect(text).toMatch(/property:\s*connectionString/);
  });
});

describe("test server", () => {
  let db: Db;
  let server: Server;
  let webDist: string;

  beforeAll(async () => {
    webDist = mkdtempSync(join(tmpdir(), "brain-core-web-"));
    writeFileSync(
      join(webDist, "index.html"),
      '<!doctype html><html><head><title>sky-brain</title></head><body><div id="root"></div></body></html>',
    );
    db = await createTestDb();
    server = await startTestServer({ db, webDist });
  }, 60_000);

  afterAll(async () => {
    if (server) await server.close();
    if (db) await closeTestDb(db);
    rmSync(webDist, { recursive: true, force: true });
  }, 60_000);

  // "answers `GET /healthz` with 200 and `{"ok":true}`, and serves an empty web page at `/`."
  it("GET /healthz answers 200 {ok:true} to anyone", async () => {
    const res = await server.anonymous.get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET / serves the web shell", async () => {
    const res = await server.anonymous.get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root"></div>');
  });
});

describe("devActorHeaderEnabled", () => {
  // Edge case: "`X-Dev-Actor` sent while the dev header is off (any NODE_ENV but `development`)"
  // Interfaces: "`devActorHeaderEnabled(env)` ... (true only for `"development"`)"
  it("is true only for NODE_ENV=development", () => {
    expect(devActorHeaderEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(devActorHeaderEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(devActorHeaderEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(devActorHeaderEnabled({ NODE_ENV: "Development" })).toBe(false);
    expect(devActorHeaderEnabled({ NODE_ENV: "" })).toBe(false);
    expect(devActorHeaderEnabled({})).toBe(false);
  });
});
