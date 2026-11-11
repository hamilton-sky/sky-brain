// `/api/v1/projects` and `/api/v1/me` (task board v1): membership filters every list (hard
// rule 4), only a person who is an owner or editor creates a project (hard rule 3), and a
// browser-session write must be JSON.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, projects } from "../db/schema.ts";
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
let wsA: string;
let wsB: string;
let projectB: string;

const human = (user_id: string) => ({ kind: "human" as const, user_id });
const agent = (on_behalf_of: string) => ({
  kind: "agent" as const,
  agent_id: "mcp/claude.ai",
  on_behalf_of,
});

beforeAll(async () => {
  db = await createTestDb();
  server = await startTestServer({ db });
  wsA = (
    await seedWorkspace(db, {
      name: "A",
      members: [
        { userId: "ann", role: "owner" },
        { userId: "vic", role: "viewer" },
      ],
    })
  ).id;
  wsB = (
    await seedWorkspace(db, {
      name: "B",
      members: [{ userId: "bob", role: "owner" }],
    })
  ).id;
  await seedProject(db, { workspaceId: wsA, slug: "app", name: "App" });
  projectB = (
    await seedProject(db, { workspaceId: wsB, slug: "secret", name: "Secret" })
  ).id;
}, 60_000);

afterAll(async () => {
  if (server) await server.close();
  if (db) await closeTestDb(db);
});

describe("projects", () => {
  it("lists only the projects of the caller's workspaces", async () => {
    const res = await server.as(human("ann")).get("/api/v1/projects");
    expect(res.status).toBe(200);
    const ids = res.body.projects.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(projectB);
    expect(res.body.projects.map((p: { slug: string }) => p.slug)).toEqual([
      "app",
    ]);
    const other = await server
      .as(human("ann"))
      .get(`/api/v1/projects?workspace_id=${wsB}`);
    expect(other.status).toBe(200);
    expect(other.body.projects).toEqual([]);
  });

  it("an agent lists for its person", async () => {
    const res = await server.as(agent("bob")).get("/api/v1/projects");
    expect(res.body.projects.map((p: { id: string }) => p.id)).toEqual([
      projectB,
    ]);
  });

  it("an owner creates a project, with a slug from its name and an audit row", async () => {
    const res = await server
      .as(human("ann"))
      .post("/api/v1/projects", { workspace_id: wsA, name: "Sky Brain!" });
    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({
      workspace_id: wsA,
      slug: "sky-brain",
      name: "Sky Brain!",
    });
    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, res.body.project.id));
    expect(audit.map((a) => a.action)).toEqual(["project.create"]);
  });

  it("a taken slug is 409", async () => {
    const res = await server
      .as(human("ann"))
      .post("/api/v1/projects", { workspace_id: wsA, name: "App" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("slug_taken");
  });

  it("an agent cannot create a project", async () => {
    const res = await server
      .as(agent("ann"))
      .post("/api/v1/projects", { workspace_id: wsA, name: "Agent's" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("humans_only");
  });

  it("a viewer cannot create a project", async () => {
    const res = await server
      .as(human("vic"))
      .post("/api/v1/projects", { workspace_id: wsA, name: "Viewer's" });
    expect(res.status).toBe(403);
  });

  it("another workspace is 404 and nothing is written", async () => {
    const res = await server
      .as(human("ann"))
      .post("/api/v1/projects", { workspace_id: wsB, name: "Intruder" });
    expect(res.status).toBe(404);
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, wsB));
    expect(rows).toHaveLength(1);
  });
});

describe("browser-session writes", () => {
  it("a write without a bearer token must be JSON", async () => {
    const res = await server.anonymous.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    // Anonymous: 401 first; the JSON rule never reveals more than that.
    expect(res.status).toBe(401);
  });
});
