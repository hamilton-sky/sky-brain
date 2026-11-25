import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeTestDb,
  createTestDb,
  seedEntry,
  seedFeature,
  seedProject,
  seedWorkspace,
} from "../testing/harness.ts";
import type { Db } from "@sky-brain/db/client";
import { writeAudit } from "@sky-brain/db/audit";
import {
  auditLog,
  entries,
  features,
  invites,
  members,
  projects,
  workspaces,
} from "@sky-brain/db/schema";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  if (db) await closeTestDb(db);
}, 60_000);

async function world(name: string) {
  const ws = await seedWorkspace(db, {
    name,
    members: [
      { userId: `${name}-owner`, role: "owner" },
      { userId: `${name}-viewer`, role: "viewer" },
    ],
  });
  const project = await seedProject(db, {
    workspaceId: ws.id,
    slug: `${name}-proj`,
    name: `${name} project`,
    gitRemote: `git@github.com:Acme/${name}.git`,
  });
  const feature = await seedFeature(db, {
    projectId: project.id,
    slug: `${name}-feat`,
    name: `${name} feature`,
  });
  return { workspaceId: ws.id, projectId: project.id, featureId: feature.id };
}

describe("migrations", () => {
  it("apply to an empty PGlite and create every table", async () => {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sql`information_schema.tables`)
      .where(sql`table_schema = 'public' and table_name in (
      'workspaces','members','invites','projects','features','entries','audit_log','devices',
      'device_codes','memories','entry_versions')`);
    expect(rows[0]?.n).toBe(11);
  });

  it("index the expiry of pending device codes, which every /api/device/code purges by", async () => {
    const rows = await db
      .select({ def: sql<string>`indexdef` })
      .from(sql`pg_indexes`).where(sql`tablename = 'device_codes'
        and indexname = 'device_codes_pending_expires_at_idx'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.def).toMatch(/\(expires_at\) WHERE \(device_id IS NULL\)/);
  });
});

describe("harness seeds", () => {
  it("stores the normalized git remote of a project", async () => {
    const ws = await seedWorkspace(db, { name: "remote" });
    const project = await seedProject(db, {
      workspaceId: ws.id,
      slug: "remote-proj",
      name: "Remote",
      gitRemote: "https://github.com/Hamilton-Sky/Sky-Brain.git",
    });
    expect(project.gitRemote).toBe("github.com/hamilton-sky/sky-brain");
    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, project.id));
    expect(row?.gitRemote).toBe("github.com/hamilton-sky/sky-brain");
  });
});

describe("workspace delete", () => {
  async function deleteWorld() {
    const doomed = await world("doomed");
    const kept = await world("kept");
    for (const w of [doomed, kept]) {
      const q = await seedEntry(db, {
        workspaceId: w.workspaceId,
        title: "q",
        body: "b",
      });
      await seedEntry(db, {
        workspaceId: w.workspaceId,
        layer: "long",
        kind: "decision",
        title: "a",
        body: "b",
      });
      await db.insert(invites).values({
        workspaceId: w.workspaceId,
        email: "x@example.com",
        role: "editor",
        invitedBy: "someone",
      });
      await writeAudit(db, {
        workspaceId: w.workspaceId,
        actor: "human:someone",
        action: "entry.create",
        targetId: q.id,
        details: { kind: "question", status: "open" },
      });
    }
    await db.delete(workspaces).where(eq(workspaces.id, doomed.workspaceId));
    return { doomed, kept };
  }

  async function counts(workspaceId: string, projectId: string) {
    const count = async (n: Promise<{ n: number }[]>) => (await n)[0]?.n;
    const c = sql<number>`count(*)::int`;
    return {
      workspaces: await count(
        db
          .select({ n: c })
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId)),
      ),
      members: await count(
        db
          .select({ n: c })
          .from(members)
          .where(eq(members.workspaceId, workspaceId)),
      ),
      invites: await count(
        db
          .select({ n: c })
          .from(invites)
          .where(eq(invites.workspaceId, workspaceId)),
      ),
      projects: await count(
        db
          .select({ n: c })
          .from(projects)
          .where(eq(projects.workspaceId, workspaceId)),
      ),
      features: await count(
        db
          .select({ n: c })
          .from(features)
          .where(eq(features.projectId, projectId)),
      ),
      entries: await count(
        db
          .select({ n: c })
          .from(entries)
          .where(eq(entries.workspaceId, workspaceId)),
      ),
      audit: await count(
        db
          .select({ n: c })
          .from(auditLog)
          .where(eq(auditLog.workspaceId, workspaceId)),
      ),
    };
  }

  let result: Awaited<ReturnType<typeof deleteWorld>>;
  beforeAll(async () => {
    result = await deleteWorld();
  });

  it("deleting a workspace removes only its rows", async () => {
    const { doomed, kept } = result;
    expect(await counts(doomed.workspaceId, doomed.projectId)).toMatchObject({
      workspaces: 0,
      members: 0,
      invites: 0,
      projects: 0,
      features: 0,
      entries: 0,
    });
    expect(await counts(kept.workspaceId, kept.projectId)).toEqual({
      workspaces: 1,
      members: 2,
      invites: 1,
      projects: 1,
      features: 1,
      entries: 2,
      audit: 1,
    });
  });

  it("deleting a workspace leaves audit_log alone", async () => {
    const { doomed } = result;
    expect((await counts(doomed.workspaceId, doomed.projectId)).audit).toBe(1);
  });
});
