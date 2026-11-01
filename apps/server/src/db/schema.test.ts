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
import type { Db } from "./client.ts";
import { writeAudit } from "./audit.ts";
import {
  auditLog,
  entries,
  features,
  invites,
  members,
  projects,
  workspaces,
} from "./schema.ts";

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
      'workspaces','members','invites','projects','features','entries','audit_log','devices')`);
    expect(rows[0]?.n).toBe(8);
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

describe("entries", () => {
  it("finds an entry by full-text search on a stemmed word of its body", async () => {
    const w = await world("fts");
    const hit = await seedEntry(db, {
      workspaceId: w.workspaceId,
      projectId: w.projectId,
      kind: "lesson",
      status: "approved",
      title: "Boot notes",
      body: "The quokkas were running migrations twice.",
    });
    await seedEntry(db, {
      workspaceId: w.workspaceId,
      projectId: w.projectId,
      kind: "lesson",
      status: "approved",
      title: "Unrelated",
      body: "Nothing to see here.",
    });
    const rows = await db
      .select({ id: entries.id })
      .from(entries)
      .where(
        sql`${entries.search} @@ websearch_to_tsquery('english', 'quokka')`,
      );
    expect(rows.map((r) => r.id)).toEqual([hit.id]);
  });

  it("gives unique, growing seq values, and a status update that draws nextval gets a higher seq", async () => {
    const w = await world("seq");
    const made = [];
    for (let i = 0; i < 3; i += 1) {
      made.push(
        await seedEntry(db, {
          workspaceId: w.workspaceId,
          kind: "note",
          status: "approved",
          title: `n${i}`,
          body: "b",
        }),
      );
    }
    const seqs = made.map((m) => m.seq);
    expect(new Set(seqs).size).toBe(3);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(typeof seqs[0]).toBe("number");

    const first = made[0]!;
    const [updated] = await db
      .update(entries)
      .set({ status: "rejected", seq: sql`nextval('entries_seq')` })
      .where(eq(entries.id, first.id))
      .returning({ seq: entries.seq });
    expect(updated!.seq).toBeGreaterThan(Math.max(...seqs));
  });

  it("refuses an entry whose project is in another workspace", async () => {
    const a = await world("xa");
    const b = await world("xb");
    await expect(
      seedEntry(db, {
        workspaceId: a.workspaceId,
        projectId: b.projectId,
        kind: "note",
        status: "approved",
        title: "t",
        body: "b",
      }),
    ).rejects.toThrow();
    await expect(
      seedEntry(db, {
        workspaceId: a.workspaceId,
        projectId: a.projectId,
        featureId: b.featureId,
        kind: "note",
        status: "approved",
        title: "t",
        body: "b",
      }),
    ).rejects.toThrow();
  });

  it("refuses a feature without a project and a confidence outside 0..1", async () => {
    const w = await world("chk");
    await expect(
      seedEntry(db, {
        workspaceId: w.workspaceId,
        featureId: w.featureId,
        kind: "note",
        status: "approved",
        title: "t",
        body: "b",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(entries).values({
        workspaceId: w.workspaceId,
        kind: "note",
        status: "approved",
        title: "t",
        body: "b",
        authorKind: "human",
        author: "u",
        onBehalfOf: "u",
        source: "human",
        confidence: 1.5,
      }),
    ).rejects.toThrow();
  });
});

describe("workspace delete", () => {
  async function deleteWorld() {
    const doomed = await world("doomed");
    const kept = await world("kept");
    for (const w of [doomed, kept]) {
      const old = await seedEntry(db, {
        workspaceId: w.workspaceId,
        projectId: w.projectId,
        featureId: w.featureId,
        kind: "decision",
        status: "superseded",
        title: "old",
        body: "b",
      });
      await seedEntry(db, {
        workspaceId: w.workspaceId,
        projectId: w.projectId,
        kind: "decision",
        status: "approved",
        title: "new",
        body: "b",
        supersedes: old.id,
      });
      const q = await seedEntry(db, {
        workspaceId: w.workspaceId,
        projectId: w.projectId,
        kind: "question",
        status: "answered",
        title: "q",
        body: "b",
      });
      await seedEntry(db, {
        workspaceId: w.workspaceId,
        projectId: w.projectId,
        kind: "answer",
        status: "approved",
        title: "a",
        body: "b",
        replyTo: q.id,
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
      entries: 4,
      audit: 1,
    });
  });

  it("deleting a workspace leaves audit_log alone", async () => {
    const { doomed } = result;
    expect((await counts(doomed.workspaceId, doomed.projectId)).audit).toBe(1);
  });
});
