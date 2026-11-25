// The MCP board tools end to end (task board v1): a real OAuth access token from the flow, the
// tools listed, a goal proposed as a draft by the agent, approved by the person (never by the
// agent), then the next task claimed and reported, and another person's project refused.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { members, projects, user } from "@sky-brain/db/schema";
import { createRateLimiter } from "@sky-brain/kernel/guards/ratelimit";
import {
  startAuthTestServer,
  type AuthTestServer,
  type Browser,
} from "../testing/auth-harness.ts";
import { closeTestDb, createTestDb, type Db } from "../testing/harness.ts";
import { boardDispatcher } from "./board-dispatch.ts";
import {
  callTool,
  CIMD_DOCUMENTS,
  decodeJwt,
  signInAndGetToken,
  toolNames,
} from "./test/flow.ts";

let db: Db;
let server: AuthTestServer;
const people: Record<
  string,
  { token: string; sub: string; projectId: string; browser: Browser }
> = {};

async function signIn(name: string) {
  const email = `${name}@example.test`;
  const { accessToken, browser } = await signInAndGetToken(server, {
    account: { subjectId: `subject-${name}`, email, firstName: name },
  });
  const sub = decodeJwt(accessToken).sub as string;
  const [member] = await db
    .select({ workspaceId: members.workspaceId })
    .from(members)
    .where(eq(members.userId, sub));
  const [project] = await db
    .insert(projects)
    .values({ workspaceId: member!.workspaceId, slug: "app", name: "App" })
    .returning({ id: projects.id });
  people[name] = {
    token: accessToken,
    sub,
    projectId: project!.id,
    browser,
  };
}

beforeAll(async () => {
  db = await createTestDb();
  server = await startAuthTestServer({ db, cimdDocuments: CIMD_DOCUMENTS });
  await signIn("ann");
  await signIn("bob");
}, 60_000);

afterAll(async () => {
  if (server) await server.close();
  if (db) await closeTestDb(db);
});

/** `tools/call` as `who`; returns isError and the parsed result. */
async function tool(who: string, name: string, args: Record<string, unknown>) {
  const res = await callTool(server, people[who]!.token, name, args);
  expect(res.status).toBe(200);
  return { isError: res.isError, body: res.body };
}

describe("mcp board tools", () => {
  it("lists the board tools beside whoami", async () => {
    const names = await toolNames(server, people.ann!.token);
    expect(names).toEqual(
      expect.arrayContaining([
        "whoami",
        "list_projects",
        "list_goals",
        "get_goal",
        "propose_goal",
        "add_tasks",
        "attach_document",
        "next_task",
        "claim_task",
        "renew_task",
        "release_task",
        "report_task",
      ]),
    );
    expect(names).not.toContain("approve_goal");
  });

  it("list_projects shows only the person's own workspaces", async () => {
    const { body } = await tool("ann", "list_projects", {});
    const ids = body.projects.map((p: { id: string }) => p.id);
    expect(ids).toContain(people.ann!.projectId);
    expect(ids).not.toContain(people.bob!.projectId);
  });

  it("runs a proposed goal: draft, human approval, next, claim, report", async () => {
    const ann = people.ann!;
    const proposed = await tool("ann", "propose_goal", {
      project_id: ann.projectId,
      title: "Ship the export",
      body: "CSV first, then JSON.",
    });
    expect(proposed.isError).toBe(false);
    const goal = proposed.body.goal;
    expect(goal.status).toBe("draft");
    expect(goal.author_kind).toBe("agent");
    expect(goal.on_behalf_of).toBe(ann.sub);

    const added = await tool("ann", "add_tasks", {
      goal_id: goal.id,
      tasks: [
        { title: "CSV writer", body: "Write rows.", files: ["src/csv.ts"] },
        { title: "JSON writer", body: "Write JSON.", depends_on: [0] },
      ],
    });
    expect(added.isError).toBe(false);

    // A draft goal has nothing ready.
    let next = await tool("ann", "next_task", { project_id: ann.projectId });
    expect(next.body.task).toBeNull();

    // The agent cannot approve, even straight through the board routes.
    const board = boardDispatcher({
      db,
      now: () => new Date(),
      limiter: createRateLimiter({ now: () => Date.now() }),
    });
    const asAgent = board.forActor({
      kind: "agent",
      agent_id: "mcp/claude.ai",
      on_behalf_of: ann.sub,
    });
    const refused = await asAgent("POST", `/goals/${goal.id}/approve`, {});
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: { code: "humans_only" } });

    // The person approves (the web page's call).
    const asAnn = board.forActor({ kind: "human", user_id: ann.sub });
    const approved = await asAnn("POST", `/goals/${goal.id}/approve`, {});
    expect(approved.status).toBe(200);

    next = await tool("ann", "next_task", { project_id: ann.projectId });
    expect(next.body.task.title).toBe("CSV writer");
    const taskId = next.body.task.id;

    const claimed = await tool("ann", "claim_task", { task_id: taskId });
    expect(claimed.isError).toBe(false);
    const claimSeq = claimed.body.task.claim_seq;
    expect(claimed.body.task.status).toBe("in_progress");

    // The second task waits on the first.
    next = await tool("ann", "next_task", { project_id: ann.projectId });
    expect(next.body.task).toBeNull();

    const noProof = await tool("ann", "report_task", {
      task_id: taskId,
      claim_seq: claimSeq,
      outcome: "done",
    });
    expect(noProof.isError).toBe(true);
    expect(noProof.body.status).toBe(400);

    const done = await tool("ann", "report_task", {
      task_id: taskId,
      claim_seq: claimSeq,
      outcome: "done",
      proof: { summary: "Wrote the CSV writer." },
    });
    expect(done.isError).toBe(false);
    expect(done.body.task.status).toBe("done");

    next = await tool("ann", "next_task", { project_id: ann.projectId });
    expect(next.body.task.title).toBe("JSON writer");
  });

  it("captures a document and attaches it to a proposed goal", async () => {
    const ann = people.ann!;
    const goal = (
      await tool("ann", "propose_goal", {
        project_id: ann.projectId,
        title: "Write the Consolidator",
        body: "Nightly merge.",
      })
    ).body.goal;
    const captured = await tool("ann", "capture", {
      kind: "decision",
      title: "Consolidator plan",
      body: "# Plan\n\nMerge the Inbox nightly.",
      summary: "Merge the Inbox into Notebooks every night.",
    });
    expect(captured.isError).toBe(false);
    const entryId = captured.body.entry.id;
    const attached = await tool("ann", "attach_document", {
      goal_id: goal.id,
      entry_id: entryId,
    });
    expect(attached.isError).toBe(false);
    const got = await tool("ann", "get_goal", { goal_id: goal.id });
    expect(got.body.documents).toMatchObject([
      {
        entry_id: entryId,
        summary: "Merge the Inbox into Notebooks every night.",
      },
    ]);
    // Bob's goal is not found, whatever entry he names.
    const bobs = await tool("bob", "attach_document", {
      goal_id: goal.id,
      entry_id: entryId,
    });
    expect(bobs.isError).toBe(true);
    expect(bobs.body.status).toBe(404);
  });

  it("refuses another person's project and goal as not found", async () => {
    const ann = people.ann!;
    const goals = await tool("bob", "list_goals", {
      project_id: ann.projectId,
    });
    expect(goals.isError).toBe(true);
    expect(goals.body.status).toBe(404);
    const proposed = await tool("bob", "propose_goal", {
      project_id: ann.projectId,
      title: "Sneak in",
      body: "No.",
    });
    expect(proposed.isError).toBe(true);
    expect(proposed.body.status).toBe(404);
    const next = await tool("bob", "next_task", { project_id: ann.projectId });
    expect(next.isError).toBe(true);
  });

  it("whoami still names the token's person", async () => {
    const [row] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, people.bob!.sub));
    const { body } = await tool("bob", "whoami", {});
    expect(body.email).toBe(row!.email);
  });

  it("the signed-in browser reads /me and approves a goal; a non-JSON write is refused", async () => {
    const bob = people.bob!;
    const json = (body: unknown) => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const me = await bob.browser.request("/api/v1/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ kind: "human", user_id: bob.sub });

    const proposed = await tool("bob", "propose_goal", {
      project_id: bob.projectId,
      title: "Tidy up",
      body: "Remove dead code.",
    });
    const goalId = proposed.body.goal.id;

    // A cross-site form can only send form or text bodies: refused before any change.
    const form = await bob.browser.request(`/api/v1/goals/${goalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(form.status).toBe(415);
    expect(form.body.error.code).toBe("json_required");

    const approved = await bob.browser.request(
      `/api/v1/goals/${goalId}/approve`,
      json({}),
    );
    expect(approved.status).toBe(200);
    expect(approved.body.goal).toMatchObject({
      status: "approved",
      approved_by: bob.sub,
    });

    // Ann's browser cannot see or approve Bob's goal.
    const intruder = await people.ann!.browser.request(
      `/api/v1/goals/${goalId}/approve`,
      json({}),
    );
    expect(intruder.status).toBe(404);
  });
});
