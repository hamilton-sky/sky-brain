// Shared setup of the run-token tests (tests only). Until the goal and task routes land
// (tickets 04-07), a tiny test-only router on a second app proves an allowed verb and
// `assertRunScope`: `GET /goals/:id` takes a project id and answers the actor, the run
// context and the effective role; `POST /tasks/:id/claim` answers 200.
import { eq } from "drizzle-orm";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect } from "vitest";
import { actorMiddleware, actorOf } from "../actor/middleware.ts";
import { runContextOf } from "../actor/run-context.ts";
import { projects } from "../db/schema.ts";
import { errorHandler } from "../http/error-handler.ts";
import { memberRole } from "../scope/member-role.ts";
import {
  closeTestDb,
  createTestDb,
  seedProject,
  seedWorkspace,
  startTestServer,
  testClient,
  type Db,
  type TestClient,
  type TestResponse,
  type TestServer,
} from "../testing/harness.ts";
import { loginDevice } from "../testing/task-seeds.ts";
import { runTokenResolver } from "./resolver.ts";
import { assertRunScope, effectiveRole } from "./run-scope.ts";
import { verbMiddleware } from "./verbs.ts";

/** A uuid no row has. */
export const UUID = "11111111-2222-4333-8444-555555555555";

export interface RunTokenFixture {
  db: Db;
  /** The real app (`createApp`) through the harness. */
  server: TestServer;
  /** A client of the test-only app. */
  onProbe: (token: string) => TestClient;
  now: () => Date;
  advance: (seconds: number) => void;
}

function probeRouter(db: Db): express.Router {
  const router = express.Router();
  router.get("/goals/:id", async (req, res) => {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, String(req.params.id)));
    if (!project) throw new Error("probe: no such project");
    assertRunScope(req, {
      workspaceId: project.workspaceId,
      projectId: project.id,
    });
    const role = await memberRole(db, project.workspaceId, actorOf(req));
    res.status(200).json({
      actor: actorOf(req),
      run: runContextOf(req) ?? null,
      role: role ? effectiveRole(req, role) : null,
    });
  });
  router.post("/tasks/:id/claim", (_req, res) => {
    res.status(200).json({ claimed: true });
  });
  return router;
}

/** Registers beforeAll/afterAll; read the fields inside tests only. */
export function useRunTokenFixture(): RunTokenFixture {
  let t = new Date("2026-11-02T10:00:00Z");
  let probe: Server | undefined;
  let probeUrl = "";
  const ctx = {
    now: () => t,
    advance: (seconds: number) => {
      t = new Date(t.getTime() + seconds * 1000);
    },
    onProbe: (token: string) => testClient(probeUrl, token),
  } as RunTokenFixture;

  beforeAll(async () => {
    ctx.db = await createTestDb();
    ctx.server = await startTestServer({ db: ctx.db, now: ctx.now });
    const app = express();
    app.use(
      "/api/v1",
      actorMiddleware({
        resolveActor: runTokenResolver(ctx.db, ctx.now),
        devActorHeader: false,
      }),
      express.json({ limit: "64kb" }),
      verbMiddleware(),
      probeRouter(ctx.db),
    );
    app.use("/api", errorHandler);
    probe = await new Promise<Server>((resolve, reject) => {
      const s = app.listen(0, "127.0.0.1", (err?: Error) =>
        err ? reject(err) : resolve(s),
      );
    });
    probeUrl = `http://127.0.0.1:${(probe.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (probe) {
      const p = probe;
      await new Promise<void>((resolve) => {
        p.close(() => resolve());
        p.closeAllConnections();
      });
    }
    if (ctx.server) await ctx.server.close();
    if (ctx.db) await closeTestDb(ctx.db);
  }, 60_000);

  return ctx;
}

let n = 0;

/** One workspace with an owner, an editor and a viewer and projects A and B; and another
 * workspace with project C where the editor is also an editor. */
export async function world(db: Db) {
  n += 1;
  const owner = `rt-owner-${n}`;
  const editor = `rt-editor-${n}`;
  const viewer = `rt-viewer-${n}`;
  const ws = await seedWorkspace(db, {
    name: `rt-${n}`,
    members: [
      { userId: owner, role: "owner" },
      { userId: editor, role: "editor" },
      { userId: viewer, role: "viewer" },
    ],
  });
  const a = await seedProject(db, {
    workspaceId: ws.id,
    slug: `rt-a-${n}`,
    name: "A",
  });
  const b = await seedProject(db, {
    workspaceId: ws.id,
    slug: `rt-b-${n}`,
    name: "B",
  });
  const other = await seedWorkspace(db, {
    name: `rt-other-${n}`,
    members: [{ userId: editor, role: "editor" }],
  });
  const c = await seedProject(db, {
    workspaceId: other.id,
    slug: `rt-c-${n}`,
    name: "C",
  });
  return {
    workspaceId: ws.id,
    projectA: a.id,
    projectB: b.id,
    projectC: c.id,
    owner,
    editor,
    viewer,
    outsider: `rt-outsider-${n}`,
  };
}

export const human = (user_id: string) => ({
  kind: "human" as const,
  user_id,
});

export const device = (server: TestServer, person: string) =>
  loginDevice(server, human(person), "laptop");

export function expectError(
  res: TestResponse,
  status: number,
  code: string,
): void {
  const body = res.body as { error?: { code?: string } } | undefined;
  expect({ status: res.status, code: body?.error?.code }).toEqual({
    status,
    code,
  });
}
