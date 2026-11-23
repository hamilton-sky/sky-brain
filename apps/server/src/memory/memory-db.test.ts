// The memory core's database guards (migrations 0007 and 0008), below the API: they hold even
// for code that skips the routes.
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { onSignIn } from "../auth/on-sign-in.ts";
import { entries, entryVersions, members, memories } from "../db/schema.ts";
import {
  closeTestDb,
  createTestDb,
  seedEntry,
  seedWorkspace,
  type Db,
} from "../testing/harness.ts";

let db: Db;
let ws: string;
let other: string;

beforeAll(async () => {
  db = await createTestDb();
  ws = (
    await seedWorkspace(db, {
      name: "w",
      members: [{ userId: "u", role: "owner" }],
    })
  ).id;
  other = (await seedWorkspace(db, { name: "o" })).id;
}, 60_000);

afterAll(async () => {
  if (db) await closeTestDb(db);
});

const failure = (message: RegExp) => ({
  cause: { message: expect.stringMatching(message) },
});

describe("memories", () => {
  it("a first sign-in makes About me, an Inbox and a Notebook", async () => {
    await onSignIn(db, { userId: "newcomer", email: "new@example.test" });
    const [m] = await db
      .select()
      .from(members)
      .where(eq(members.userId, "newcomer"));
    const rows = await db
      .select()
      .from(memories)
      .where(eq(memories.workspaceId, m!.workspaceId));
    expect(rows.map((r) => r.layer).sort()).toEqual(["core", "long", "short"]);
  });

  it("refuses a second About me", async () => {
    await expect(
      db.insert(memories).values({
        workspaceId: ws,
        layer: "core",
        name: "Two",
        isDefault: true,
      }),
    ).rejects.toMatchObject(failure(/memories_one_core/));
  });
});

describe("entries", () => {
  it("refuses an agent-written row in About me", async () => {
    await expect(
      seedEntry(db, {
        workspaceId: ws,
        layer: "core",
        authorKind: "agent",
        title: "t",
        body: "b",
      }),
    ).rejects.toMatchObject(failure(/entries_core_human/));
  });

  it("refuses a layer that is not its memory's", async () => {
    const [inbox] = await db
      .select({ id: memories.id })
      .from(memories)
      .where(eq(memories.workspaceId, ws));
    await expect(
      seedEntry(db, {
        workspaceId: ws,
        memoryId: inbox!.id,
        layer: "working",
        title: "t",
        body: "b",
      }),
    ).rejects.toMatchObject(
      failure(/entries_in_memory_fk|entries_short_fades/),
    );
  });

  it("never moves to another memory or brain", async () => {
    const e = await seedEntry(db, { workspaceId: ws, title: "t", body: "b" });
    const [target] = await db
      .select({ id: memories.id })
      .from(memories)
      .where(eq(memories.workspaceId, other));
    await expect(
      db
        .update(entries)
        .set({ memoryId: target!.id })
        .where(eq(entries.id, e.id)),
    ).rejects.toMatchObject(failure(/never moves/));
  });

  it("changes text only with a new version row, and bumps seq on every change", async () => {
    const e = await seedEntry(db, { workspaceId: ws, title: "t", body: "b" });
    await expect(
      db
        .update(entries)
        .set({ body: "edited in place" })
        .where(eq(entries.id, e.id)),
    ).rejects.toMatchObject(failure(/only with a new version/));

    const [before] = await db
      .select()
      .from(entries)
      .where(eq(entries.id, e.id));
    const [after] = await db
      .update(entries)
      .set({ trust: "rejected" })
      .where(eq(entries.id, e.id))
      .returning();
    expect(after!.seq).toBeGreaterThan(before!.seq);
  });

  it("keeps versions append-only", async () => {
    const e = await seedEntry(db, { workspaceId: ws, title: "t", body: "b" });
    await expect(
      db
        .update(entryVersions)
        .set({ body: "x" })
        .where(eq(entryVersions.entryId, e.id)),
    ).rejects.toMatchObject(failure(/append-only/));
    await expect(
      db.delete(entryVersions).where(eq(entryVersions.entryId, e.id)),
    ).rejects.toMatchObject(failure(/append-only/));
  });

  it("a workspace delete still cascades through the versions", async () => {
    const doomed = (await seedWorkspace(db, { name: "doomed" })).id;
    const e = await seedEntry(db, {
      workspaceId: doomed,
      title: "t",
      body: "b",
    });
    await db.execute(sql`delete from workspaces where id = ${doomed}`);
    const left = await db
      .select()
      .from(entryVersions)
      .where(eq(entryVersions.entryId, e.id));
    expect(left).toHaveLength(0);
  });
});
