// Approval requests (D31): an agent asks, only a person decides; what the person saw is what is
// applied; another brain cannot read or decide; expired and changed requests apply nothing.
import type { Actor } from "@sky-brain/shared/actor";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { entries, goals } from "@sky-brain/db/schema";
import {
  closeTestDb,
  createTestDb,
  seedEntry,
  seedProject,
  seedWorkspace,
  startTestServer,
  type Db,
  type TestServer,
} from "../testing/harness.ts";
import { seedGoal } from "../testing/task-seeds.ts";

let db: Db;
let server: TestServer;
let clock = new Date("2026-11-24T12:00:00Z");
let wsA: string;
let wsB: string;
let projectA: string;

const alice: Actor = { kind: "human", user_id: "alice" }; // owner of A
const aliceAgent: Actor = {
  kind: "agent",
  agent_id: "mcp/claude.ai/po",
  on_behalf_of: "alice",
};
const vic: Actor = { kind: "human", user_id: "vic" }; // viewer in A
const vicAgent: Actor = {
  kind: "agent",
  agent_id: "mcp/claude.ai",
  on_behalf_of: "vic",
};
const bob: Actor = { kind: "human", user_id: "bob" }; // owner of B
const bobAgent: Actor = {
  kind: "agent",
  agent_id: "mcp/codex",
  on_behalf_of: "bob",
};

const brain = async (name: string, people: [string, "owner" | "viewer"][]) =>
  (
    await seedWorkspace(db, {
      name,
      members: people.map(([userId, role]) => ({ userId, role })),
    })
  ).id;

beforeAll(async () => {
  db = await createTestDb();
  wsA = await brain("a", [
    ["alice", "owner"],
    ["vic", "viewer"],
  ]);
  wsB = await brain("b", [["bob", "owner"]]);
  projectA = (
    await seedProject(db, { workspaceId: wsA, slug: "home", name: "Home" })
  ).id;
  server = await startTestServer({ db, now: () => clock });
}, 60_000);

afterAll(async () => {
  await server?.close();
  if (db) await closeTestDb(db);
});

beforeEach(() => {
  clock = new Date(clock.getTime() + 2 * 60 * 60_000);
});

const draftGoal = (title = "Plan the school year") =>
  seedGoal(db, {
    workspaceId: wsA,
    projectId: projectA,
    title,
    authorKind: "agent",
    author: "mcp/claude.ai/po",
    onBehalfOf: "alice",
  });

const proposedEntry = (workspaceId = wsA) =>
  seedEntry(db, {
    workspaceId,
    trust: "proposed",
    title: "Kids sleep at 20:30",
    body: "Bedtime is 20:30 on school nights.",
    authorKind: "agent",
    author: "mcp/claude.ai/po",
  });

async function ask(actor: Actor, items: { kind: string; id: string }[]) {
  return server
    .as(actor)
    .post("/api/v1/approvals", { items, reason: "Ready to start" });
}

/** A draft goal and the id of the agent's request to approve it. */
async function askGoal(): Promise<{ goalId: string; id: string }> {
  const goal = await draftGoal();
  const res = await ask(aliceAgent, [{ kind: "goal", id: goal.id }]);
  return { goalId: goal.id, id: res.body.approval.id as string };
}

const decide = (actor: Actor, id: string, action: "approve" | "reject") =>
  server.as(actor).post(`/api/v1/approvals/${id}/${action}`);

async function goalStatus(id: string): Promise<string> {
  const [g] = await db.select().from(goals).where(eq(goals.id, id));
  return g!.status;
}

describe("asking", () => {
  it("an agent asks and gets a link to sky-brain's own page", async () => {
    const goal = await draftGoal();
    const entry = await proposedEntry();
    const res = await ask(aliceAgent, [
      { kind: "goal", id: goal.id },
      { kind: "entry", id: entry.id },
    ]);
    expect(res.status).toBe(201);
    const a = res.body.approval;
    expect(a.status).toBe("pending");
    expect(a.path).toBe(`/a/${a.id}`);
    expect(a.requested_by).toBe("mcp/claude.ai/po");
    expect(a.items.map((i: { changed: boolean }) => i.changed)).toEqual([
      false,
      false,
    ]);
  });

  it("refuses items that are not waiting, from another brain, or mixed", async () => {
    const approved = await seedGoal(db, {
      workspaceId: wsA,
      projectId: projectA,
      status: "approved",
    });
    expect(
      (await ask(aliceAgent, [{ kind: "goal", id: approved.id }])).status,
    ).toBe(409);
    const theirs = await proposedEntry(wsB);
    expect(
      (await ask(aliceAgent, [{ kind: "entry", id: theirs.id }])).status,
    ).toBe(404);
    const mine = await proposedEntry();
    const mixed = await ask(bobAgent, [
      { kind: "entry", id: theirs.id },
      { kind: "entry", id: mine.id },
    ]);
    expect(mixed.status).toBe(404);
  });

  it("a viewer's agent cannot ask", async () => {
    const goal = await draftGoal();
    expect((await ask(vicAgent, [{ kind: "goal", id: goal.id }])).status).toBe(
      403,
    );
  });
});

describe("deciding", () => {
  it("an agent cannot approve, whatever it sends", async () => {
    const { goalId, id } = await askGoal();
    const res = await server
      .as(aliceAgent)
      .post(`/api/v1/approvals/${id}/approve`, { approved: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("humans_only");
    expect(await goalStatus(goalId)).toBe("draft");
  });

  it("the person approves: every item is applied and the agent sees it", async () => {
    const goal = await draftGoal();
    const entry = await proposedEntry();
    const { id } = (
      await ask(aliceAgent, [
        { kind: "goal", id: goal.id },
        { kind: "entry", id: entry.id },
      ])
    ).body.approval;
    const res = await decide(alice, id, "approve");
    expect(res.status).toBe(200);
    expect(res.body.approval.status).toBe("approved");
    expect(res.body.approval.decided_by).toBe("alice");
    const [g] = await db.select().from(goals).where(eq(goals.id, goal.id));
    expect(g!.status).toBe("approved");
    expect(g!.approvedBy).toBe("alice");
    const [e] = await db.select().from(entries).where(eq(entries.id, entry.id));
    expect(e!.trust).toBe("approved");
    const seen = await server.as(aliceAgent).get(`/api/v1/approvals/${id}`);
    expect(seen.body.approval.status).toBe("approved");
    // Single use.
    const again = await server
      .as(alice)
      .post(`/api/v1/approvals/${id}/approve`);
    expect(again.status).toBe(409);
  });

  it("rejecting applies nothing", async () => {
    const { goalId, id } = await askGoal();
    const res = await decide(alice, id, "reject");
    expect(res.body.approval.status).toBe("rejected");
    expect(await goalStatus(goalId)).toBe("draft");
  });

  it("a changed item supersedes the request and nothing is applied", async () => {
    const goal = await draftGoal();
    const entry = await proposedEntry();
    const { id } = (
      await ask(aliceAgent, [
        { kind: "entry", id: entry.id },
        { kind: "goal", id: goal.id },
      ])
    ).body.approval;
    await db
      .update(goals)
      .set({
        title: "Something else",
        updatedAt: new Date(clock.getTime() + 1),
      })
      .where(eq(goals.id, goal.id));
    const shown = await server.as(alice).get(`/api/v1/approvals/${id}`);
    expect(shown.body.approval.items[1].changed).toBe(true);
    const res = await decide(alice, id, "approve");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("superseded");
    const [e] = await db.select().from(entries).where(eq(entries.id, entry.id));
    expect(e!.trust).toBe("proposed");
    const after = await server.as(alice).get(`/api/v1/approvals/${id}`);
    expect(after.body.approval.status).toBe("superseded");
  });

  it("an expired request applies nothing", async () => {
    const { goalId, id } = await askGoal();
    clock = new Date(clock.getTime() + 61 * 60_000);
    const res = await decide(alice, id, "approve");
    expect(res.status).toBe(410);
    expect(await goalStatus(goalId)).toBe("draft");
  });

  it("a viewer and another brain's person cannot decide", async () => {
    const { id } = await askGoal();
    expect((await decide(vic, id, "approve")).status).toBe(403);
    expect((await decide(bob, id, "approve")).status).toBe(404);
    expect((await server.as(bob).get(`/api/v1/approvals/${id}`)).status).toBe(
      404,
    );
  });
});

describe("listing", () => {
  it("lists only pending requests in the person's own brains", async () => {
    const { id } = await askGoal();
    const mine = await server.as(alice).get("/api/v1/approvals");
    expect(mine.body.approvals.map((a: { id: string }) => a.id)).toContain(id);
    const theirs = await server.as(bob).get("/api/v1/approvals");
    expect(
      theirs.body.approvals.map((a: { id: string }) => a.id),
    ).not.toContain(id);
  });

  it("caps open requests per agent", async () => {
    clock = new Date(clock.getTime() + 2 * 60 * 60_000);
    let last = "";
    for (let i = 0; i < 11; i++) {
      const goal = await draftGoal(`flood ${i}`);
      const res = await ask(aliceAgent, [{ kind: "goal", id: goal.id }]);
      last = res.status === 201 ? "ok" : res.body.error.code;
    }
    expect(last).toBe("too_many_open");
  });
});
