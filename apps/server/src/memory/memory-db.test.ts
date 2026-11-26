// The memory core's database guards (migrations 0007, 0008 and 0013), below the API: they hold even
// for code that skips the routes.
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { onSignIn } from "../auth/on-sign-in.ts";
import { captureEntry } from "@sky-brain/memory/entries-service";
import {
  coreEntryHats,
  entries,
  entryVersions,
  hats,
  members,
  memories,
} from "@sky-brain/db/schema";
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

const memoryOf = async (workspaceId: string, layer: "core" | "long") => {
  const [m] = await db
    .select()
    .from(memories)
    .where(
      and(eq(memories.workspaceId, workspaceId), eq(memories.layer, layer)),
    );
  return m!;
};

describe("hats (D30, migration 0013)", () => {
  let parent: string;
  let otherHat: string;
  beforeAll(async () => {
    [{ id: parent }] = (await db
      .insert(hats)
      .values({ workspaceId: ws, slug: "parent", name: "Parent" })
      .returning({ id: hats.id })) as [{ id: string }];
    [{ id: otherHat }] = (await db
      .insert(hats)
      .values({ workspaceId: other, slug: "work", name: "Work" })
      .returning({ id: hats.id })) as [{ id: string }];
  });

  it("refuses a bad slug and a second hat with the same slug", async () => {
    await expect(
      db.insert(hats).values({ workspaceId: ws, slug: "No Caps", name: "x" }),
    ).rejects.toMatchObject(failure(/hats_slug_format/));
    await expect(
      db.insert(hats).values({ workspaceId: ws, slug: "parent", name: "x" }),
    ).rejects.toMatchObject(failure(/hats_ws_slug_unique/));
  });

  it("puts a Notebook under a hat of its own brain", async () => {
    const notebook = await memoryOf(ws, "long");
    await db
      .update(memories)
      .set({ hatId: parent })
      .where(eq(memories.id, notebook.id));
    expect((await memoryOf(ws, "long")).hatId).toBe(parent);
    await db
      .update(memories)
      .set({ hatId: null })
      .where(eq(memories.id, notebook.id));
  });

  it("refuses another brain's hat on a memory", async () => {
    const notebook = await memoryOf(ws, "long");
    await expect(
      db
        .update(memories)
        .set({ hatId: otherHat })
        .where(eq(memories.id, notebook.id)),
    ).rejects.toMatchObject(failure(/memories_hat_in_ws_fk/));
  });

  it("refuses a hat on About me itself", async () => {
    const core = await memoryOf(ws, "core");
    await expect(
      db
        .update(memories)
        .set({ hatId: parent })
        .where(eq(memories.id, core.id)),
    ).rejects.toMatchObject(failure(/memories_core_no_hat/));
  });

  it("tags an About me entry, and only an About me entry of the same brain", async () => {
    const core = await seedEntry(db, {
      workspaceId: ws,
      layer: "core",
      title: "Two kids",
      body: "Two kids.",
    });
    await db
      .insert(coreEntryHats)
      .values({ entryId: core.id, hatId: parent, workspaceId: ws });
    const tags = await db
      .select()
      .from(coreEntryHats)
      .where(eq(coreEntryHats.entryId, core.id));
    expect(tags.map((t) => t.hatId)).toEqual([parent]);

    const inbox = await seedEntry(db, {
      workspaceId: ws,
      title: "Inbox note",
      body: "n",
    });
    await expect(
      db
        .insert(coreEntryHats)
        .values({ entryId: inbox.id, hatId: parent, workspaceId: ws }),
    ).rejects.toMatchObject(failure(/not an About me entry/));

    const theirs = await seedEntry(db, {
      workspaceId: other,
      layer: "core",
      title: "x",
      body: "x",
    });
    await expect(
      db
        .insert(coreEntryHats)
        .values({ entryId: theirs.id, hatId: parent, workspaceId: ws }),
    ).rejects.toMatchObject(failure(/not an About me entry/));
  });

  it("records the writer's hat on a capture, and none without one", async () => {
    const hat = { id: parent, slug: "parent", name: "Parent" };
    const body = {
      kind: "fact",
      title: "School pickup at 4",
      body: "Mondays.",
      summary: "School pickup is at 4 on Mondays.",
    } as const;
    const withHat = await captureEntry(
      db,
      { kind: "agent", agent_id: "mcp/test", on_behalf_of: "u", hat },
      body,
      new Date(),
    );
    const without = await captureEntry(
      db,
      { kind: "agent", agent_id: "mcp/test", on_behalf_of: "u" },
      body,
      new Date(),
    );
    const hatOf = async (entryId: string) =>
      (
        await db
          .select({ h: entryVersions.captureHatId })
          .from(entryVersions)
          .where(eq(entryVersions.entryId, entryId))
      )[0]!.h;
    expect(await hatOf(withHat.id)).toBe(parent);
    expect(await hatOf(without.id)).toBeNull();
  });
});
