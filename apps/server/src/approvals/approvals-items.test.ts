// Deciding an approval request item by item (D39): the person picks which items to approve,
// rejects some, skips the rest, and may keep an approved entry in another memory (a Notebook,
// About me). Only the owner keeps something in About me; a target must be in the same brain.
import type { Actor } from "@sky-brain/shared/actor";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { entries, goals, memories } from "@sky-brain/db/schema";
import * as h from "../testing/harness.ts";
import { seedGoal } from "../testing/task-seeds.ts";

let db: h.Db;
let server: h.TestServer;
let clock = new Date("2026-11-26T12:00:00Z");
let wsA: string;
let wsB: string;
let projectA: string;

const alice: Actor = { kind: "human", user_id: "alice" }; // owner of A
const eve: Actor = { kind: "human", user_id: "eve" }; // editor in A
const aliceAgent: Actor = {
  kind: "agent",
  agent_id: "mcp/claude.ai/po",
  on_behalf_of: "alice",
};
const bob: Actor = { kind: "human", user_id: "bob" }; // owner of B

beforeAll(async () => {
  db = await h.createTestDb();
  wsA = (
    await h.seedWorkspace(db, {
      name: "a",
      members: [
        { userId: "alice", role: "owner" },
        { userId: "eve", role: "editor" },
      ],
    })
  ).id;
  wsB = (
    await h.seedWorkspace(db, {
      name: "b",
      members: [{ userId: "bob", role: "owner" }],
    })
  ).id;
  projectA = (
    await h.seedProject(db, { workspaceId: wsA, slug: "home", name: "Home" })
  ).id;
  server = await h.startTestServer({ db, now: () => clock });
}, 60_000);

// Each test starts two hours later, so no earlier request is still open.
beforeEach(() => void (clock = new Date(clock.getTime() + 7_200_000)));

afterAll(async () => {
  if (db) {
    await server?.close();
    await h.closeTestDb(db);
  }
});

async function memoryOf(workspaceId: string, layer: "core" | "long") {
  const [m] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(
      and(eq(memories.workspaceId, workspaceId), eq(memories.layer, layer)),
    );
  return m!.id;
}

const proposed = (title: string, workspaceId = wsA) =>
  h.seedEntry(db, {
    workspaceId,
    trust: "proposed",
    title,
    body: `${title}, as the agent heard it.`,
    authorKind: "agent",
    author: "mcp/claude.ai/po",
  });

const draftGoal = () =>
  seedGoal(db, {
    workspaceId: wsA,
    projectId: projectA,
    title: "Plan the week",
    authorKind: "agent",
    author: "mcp/claude.ai/po",
    onBehalfOf: "alice",
  });

async function ask(items: { kind: string; id: string; save_to?: string }[]) {
  const res = await server
    .as(aliceAgent)
    .post("/api/v1/approvals", { items, reason: "Keep these" });
  return res;
}

const approve = (actor: Actor, id: string, body?: unknown) =>
  server.as(actor).post(`/api/v1/approvals/${id}/approve`, body);

async function entry(id: string) {
  const [e] = await db.select().from(entries).where(eq(entries.id, id));
  return e!;
}

describe("item by item", () => {
  it("approves only the picked items, rejects one, leaves the rest", async () => {
    const a = await proposed("Kids sleep at 20:30");
    const b = await proposed("School starts at 8");
    const c = await proposed("A guess about lunch");
    const goal = await draftGoal();
    const { id } = (
      await ask([
        { kind: "entry", id: a.id },
        { kind: "entry", id: b.id },
        { kind: "entry", id: c.id },
        { kind: "goal", id: goal.id },
      ])
    ).body.approval;
    const res = await approve(alice, id, {
      items: [
        { id: a.id, action: "approve" },
        { id: c.id, action: "reject" },
        { id: goal.id, action: "reject" },
      ],
    });
    expect(res.status).toBe(200);
    const out = res.body.approval;
    expect(out.status).toBe("approved");
    expect(out.items.map((i: { outcome: string }) => i.outcome)).toEqual([
      "approved",
      "skipped",
      "rejected",
      "rejected",
    ]);
    expect((await entry(a.id)).trust).toBe("approved");
    expect((await entry(b.id)).trust).toBe("proposed");
    expect((await entry(c.id)).trust).toBe("rejected");
    const [g] = await db.select().from(goals).where(eq(goals.id, goal.id));
    expect(g!.status).toBe("cancelled");
    // The agent reads the same outcomes.
    const seen = await server.as(aliceAgent).get(`/api/v1/approvals/${id}`);
    expect(seen.body.approval.items[1].outcome).toBe("skipped");
    expect(seen.body.approval.targets).toEqual([]);
  });

  it("rejecting every picked item makes the request rejected", async () => {
    const a = await proposed("Rejected one");
    const { id } = (await ask([{ kind: "entry", id: a.id }])).body.approval;
    const res = await approve(alice, id, {
      items: [{ id: a.id, action: "reject" }],
    });
    expect(res.body.approval.status).toBe("rejected");
  });

  it("refuses nothing picked, unknown items and a skip with a memory", async () => {
    const a = await proposed("Picky");
    const { id } = (await ask([{ kind: "entry", id: a.id }])).body.approval;
    expect((await approve(alice, id, { items: [] })).status).toBe(400);
    const other = await proposed("Not in it");
    expect(
      (
        await approve(alice, id, {
          items: [{ id: other.id, action: "approve" }],
        })
      ).status,
    ).toBe(400);
    const nb = await memoryOf(wsA, "long");
    expect(
      (
        await approve(alice, id, {
          items: [{ id: a.id, action: "skip", save_to: nb }],
        })
      ).status,
    ).toBe(400);
    expect((await entry(a.id)).trust).toBe("proposed");
  });

  it("a changed item that was skipped does not block the others", async () => {
    const a = await proposed("Steady");
    const b = await proposed("Will change");
    const { id } = (
      await ask([
        { kind: "entry", id: a.id },
        { kind: "entry", id: b.id },
      ])
    ).body.approval;
    await db.update(entries).set({ version: 2 }).where(eq(entries.id, b.id));
    const res = await approve(alice, id, {
      items: [{ id: a.id, action: "approve" }],
    });
    expect(res.status).toBe(200);
    expect((await entry(a.id)).trust).toBe("approved");
  });
});

describe("keeping in another memory", () => {
  it("the person keeps an entry in a Notebook: a copy that points back", async () => {
    const a = await proposed("We host on Vercel");
    const nb = await memoryOf(wsA, "long");
    const { id } = (await ask([{ kind: "entry", id: a.id }])).body.approval;
    const shown = await server.as(alice).get(`/api/v1/approvals/${id}`);
    expect(
      shown.body.approval.targets.map((t: { layer: string }) => t.layer),
    ).toEqual(["core", "long", "short"]);
    const res = await approve(alice, id, {
      items: [{ id: a.id, action: "approve", save_to: nb }],
    });
    expect(res.status).toBe(200);
    const savedAs = res.body.approval.items[0].saved_as as string;
    const copy = await entry(savedAs);
    expect(copy.memoryId).toBe(nb);
    expect(copy.layer).toBe("long");
    expect(copy.trust).toBe("approved");
    expect(copy.authorKind).toBe("human");
    expect(copy.author).toBe("alice");
    expect(copy.refs).toContain(`entry:${a.id}`);
    expect((await entry(a.id)).trust).toBe("approved");
  });

  it("uses the agent's suggestion when the person approves all", async () => {
    const a = await proposed("Mornings are for deep work");
    const nb = await memoryOf(wsA, "long");
    const asked = await ask([{ kind: "entry", id: a.id, save_to: nb }]);
    expect(asked.body.approval.items[0].save_to).toBe(nb);
    const res = await approve(alice, asked.body.approval.id);
    expect((await entry(res.body.approval.items[0].saved_as)).memoryId).toBe(
      nb,
    );
  });

  it("the owner keeps a fact in About me", async () => {
    const a = await proposed("I answer in Hebrew when written to in Hebrew");
    const core = await memoryOf(wsA, "core");
    const { id } = (await ask([{ kind: "entry", id: a.id }])).body.approval;
    const res = await approve(alice, id, {
      items: [{ id: a.id, action: "approve", save_to: core }],
    });
    expect(res.status).toBe(200);
    const copy = await entry(res.body.approval.items[0].saved_as);
    expect(copy.layer).toBe("core");
    expect(copy.authorKind).toBe("human");
  });

  it("an editor cannot keep it in About me, and nothing is applied", async () => {
    const a = await proposed("Eve's try");
    const core = await memoryOf(wsA, "core");
    const { id } = (await ask([{ kind: "entry", id: a.id }])).body.approval;
    const shown = await server.as(eve).get(`/api/v1/approvals/${id}`);
    expect(
      shown.body.approval.targets.map((t: { layer: string }) => t.layer),
    ).not.toContain("core");
    const res = await approve(eve, id, {
      items: [{ id: a.id, action: "approve", save_to: core }],
    });
    expect(res.status).toBe(400);
    expect((await entry(a.id)).trust).toBe("proposed");
  });

  it("refuses a memory in another brain, asked or decided", async () => {
    const a = await proposed("Cross-brain");
    const theirs = await memoryOf(wsB, "long");
    expect(
      (await ask([{ kind: "entry", id: a.id, save_to: theirs }])).status,
    ).toBe(400);
    const { id } = (await ask([{ kind: "entry", id: a.id }])).body.approval;
    const res = await approve(alice, id, {
      items: [{ id: a.id, action: "approve", save_to: theirs }],
    });
    expect(res.status).toBe(400);
    expect((await entry(a.id)).trust).toBe("proposed");
    expect((await approve(bob, id, {})).status).toBe(404);
  });

  it("a goal has no memory to be kept in", async () => {
    const goal = await draftGoal();
    const nb = await memoryOf(wsA, "long");
    expect(
      (await ask([{ kind: "goal", id: goal.id, save_to: nb }])).status,
    ).toBe(400);
  });
});
