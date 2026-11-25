// Package test for memories.ts: runs against a migrated PGlite, without the app (PACKAGES.md).
// Who may read which memory comes from membership: another workspace sees nothing, and About me
// is the owner's alone.
import type { Actor } from "@sky-brain/shared/actor";
import { members, workspaces } from "@sky-brain/db/schema";
import type { Db } from "@sky-brain/db/client";
import { closeTestDb, createTestDb } from "@sky-brain/db/test-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDefaultMemories,
  defaultMemory,
  findMemory,
  listMemories,
  ownWorkspace,
} from "./memories.ts";

const owner: Actor = { kind: "human", user_id: "ana" };
const editor: Actor = { kind: "human", user_id: "ben" };
const stranger: Actor = { kind: "human", user_id: "cy" };
const agent: Actor = {
  kind: "agent",
  agent_id: "mcp/test",
  on_behalf_of: "ana",
};

let db: Db;
let wsId: string;

beforeAll(async () => {
  db = await createTestDb();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: "Ana's brain" })
    .returning({ id: workspaces.id });
  wsId = ws!.id;
  await createDefaultMemories(db, wsId);
  await db.insert(members).values([
    { workspaceId: wsId, userId: "ana", role: "owner" },
    { workspaceId: wsId, userId: "ben", role: "editor" },
  ]);
  // A second brain the members above do not belong to.
  const [other] = await db
    .insert(workspaces)
    .values({ name: "Cy's brain" })
    .returning({ id: workspaces.id });
  await createDefaultMemories(db, other!.id);
  await db
    .insert(members)
    .values({ workspaceId: other!.id, userId: "cy", role: "owner" });
});

afterAll(() => closeTestDb(db));

describe("memories", () => {
  it("lists the three defaults to the owner and to an agent acting for them", async () => {
    for (const actor of [owner, agent]) {
      const rows = await listMemories(db, actor, wsId);
      expect(rows.map((m) => m.layer).sort()).toEqual([
        "core",
        "long",
        "short",
      ]);
    }
  });

  it("hides About me from a member who is not the owner", async () => {
    const rows = await listMemories(db, editor, wsId);
    expect(rows.map((m) => m.layer).sort()).toEqual(["long", "short"]);
    const core = await defaultMemory(db, wsId, "core");
    await expect(findMemory(db, editor, core.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(findMemory(db, owner, core.id)).resolves.toMatchObject({
      role: "owner",
    });
  });

  it("refuses another workspace's memories", async () => {
    await expect(listMemories(db, stranger, wsId)).rejects.toMatchObject({
      status: 404,
    });
    const all = await listMemories(db, stranger);
    expect(all.every((m) => m.workspaceId !== wsId)).toBe(true);
    const inbox = await defaultMemory(db, wsId, "short");
    await expect(findMemory(db, stranger, inbox.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("finds the caller's own brain, and none for an editor", async () => {
    await expect(ownWorkspace(db, owner)).resolves.toBe(wsId);
    await expect(ownWorkspace(db, editor)).rejects.toMatchObject({
      status: 404,
    });
  });
});
