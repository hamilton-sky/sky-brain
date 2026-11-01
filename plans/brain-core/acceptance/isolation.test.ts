// Story: Workspaces stay apart. (Bar item 5.)
import { beforeAll, describe, expect, it } from "vitest";
import {
  AGENT_ID,
  agent,
  entry,
  expectError,
  human,
  seed,
  seedWorld,
  setup,
  snapshot,
  type Client,
  type Res,
  type World,
} from "./helpers.ts";

const ctx = setup();
let a: World;
let b: World;
const remoteB = "https://github.com/acme-b/other-repo.git";
let bIds: {
  decision: string;
  proposed: string;
  quarantined: string;
  question: string;
  agentQuestion: string;
  title: string;
};

beforeAll(async () => {
  a = await seedWorld(ctx.db, {
    gitRemote: "https://github.com/acme-a/repo.git",
  });
  b = await seedWorld(ctx.db, { gitRemote: remoteB });
  const title = "Bravo isolation quokka";
  const decision = await seed(ctx.db, b, "decision", "approved", {
    title,
    body: "quokka quokka",
  });
  const proposed = await seed(ctx.db, b, "decision", "proposed", {
    title: `${title} proposed`,
    authorKind: "agent",
    author: AGENT_ID,
    onBehalfOf: b.owner,
  });
  const quarantined = await seed(ctx.db, b, "note", "quarantined", {
    title: `${title} quarantined`,
    quarantinedBecause: "role-tag",
  });
  const question = await seed(ctx.db, b, "question", "open", {
    title: `${title} question`,
    level: "feature",
  });
  const agentQuestion = await seed(ctx.db, b, "question", "open", {
    title: `${title} agent question`,
    authorKind: "agent",
    author: AGENT_ID,
    onBehalfOf: b.owner,
    allowAgentAnswers: true,
  });
  bIds = {
    decision: decision.id,
    proposed: proposed.id,
    quarantined: quarantined.id,
    question: question.id,
    agentQuestion: agentQuestion.id,
    title,
  };
}, 60_000);

/** Every route an agent may call, with B's ids. */
async function agentRoutes(c: Client): Promise<[string, Res][]> {
  const out: [string, Res][] = [];
  for (const id of [
    bIds.decision,
    bIds.proposed,
    bIds.quarantined,
    bIds.question,
  ]) {
    out.push([`get ${id}`, await c.get(`/api/v1/entries/${id}`)]);
    out.push([
      `supersede ${id}`,
      await c.post(`/api/v1/entries/${id}/supersede`, {
        title: "Mine",
        body: "b",
      }),
    ]);
  }
  for (const [key, id] of [
    ["workspace_id", b.workspaceId],
    ["project_id", b.projectId],
    ["feature_id", b.featureId],
  ]) {
    out.push([`search ${key}`, await c.get(`/api/v1/entries?${key}=${id}`)]);
  }
  for (const scope of [b.proj, b.feat]) {
    out.push([
      `post ${JSON.stringify(scope)}`,
      await c.post("/api/v1/entries", entry(scope, "note")),
    ]);
    out.push([
      `ask ${JSON.stringify(scope)}`,
      await c.post("/api/v1/ask", { scope, title: "Q", body: "b" }),
    ]);
  }
  for (const scope of [b.ws, b.proj, b.feat]) {
    out.push([
      `context ${JSON.stringify(scope)}`,
      await c.post("/api/v1/context", { scope, task: "quokka" }),
    ]);
  }
  out.push([
    "post answer to B's agent question",
    await c.post("/api/v1/entries", {
      kind: "answer",
      reply_to: bIds.agentQuestion,
      title: "A",
      body: "b",
    }),
  ]);
  out.push([
    "lookup B workspace",
    await c.post("/api/v1/projects/lookup", {
      workspace_id: b.workspaceId,
      git_remote: remoteB,
    }),
  ]);
  out.push([
    "lookup B remote in A",
    await c.post("/api/v1/projects/lookup", {
      workspace_id: a.workspaceId,
      git_remote: remoteB,
    }),
  ]);
  return out;
}

function expectAllNotFound(results: [string, Res][]): void {
  const got = results.map(([label, res]) => [
    label,
    res.status,
    res.body?.error?.code,
  ]);
  const want = results.map(([label]) => [label, 404, "not_found"]);
  expect(got).toEqual(want);
}

describe("workspace A cannot reach workspace B", () => {
  // "Every route, called by a human owner of A with B's ids (an entry id, a scope id, a workspace
  // id, B's git remote), answers 404 `not_found` (search never returns a B entry), and B's data
  // is unchanged."
  it("every route answers a human owner of A 404 not_found for B's ids, and B is unchanged", async () => {
    const before = await snapshot(ctx.db, b.workspaceId);
    const c = ctx.server.as(human(a.owner));
    const results = await agentRoutes(c);
    for (const id of [
      bIds.decision,
      bIds.proposed,
      bIds.quarantined,
      bIds.question,
    ]) {
      results.push([
        `approve ${id}`,
        await c.post(`/api/v1/entries/${id}/approve`),
      ]);
      results.push([
        `reject ${id}`,
        await c.post(`/api/v1/entries/${id}/reject`),
      ]);
      results.push([
        `release ${id}`,
        await c.post(`/api/v1/entries/${id}/release`),
      ]);
      results.push([
        `answer ${id}`,
        await c.post(`/api/v1/entries/${id}/answer`, { body: "b" }),
      ]);
    }
    results.push([
      "post answer to B's question",
      await c.post("/api/v1/entries", {
        kind: "answer",
        reply_to: bIds.question,
        title: "A",
        body: "b",
      }),
    ]);
    results.push([
      "post into B's workspace scope",
      await c.post("/api/v1/entries", entry(b.ws, "rule")),
    ]);
    results.push([
      "export B",
      await c.get(`/api/v1/workspaces/${b.workspaceId}/export`),
    ]);
    results.push([
      "delete B",
      await c.delete(`/api/v1/workspaces/${b.workspaceId}`, {
        confirm: b.name,
      }),
    ]);
    expectAllNotFound(results);
    expect(await snapshot(ctx.db, b.workspaceId)).toEqual(before);
  });

  it("search in A never returns a B entry", async () => {
    const c = ctx.server.as(human(a.owner));
    for (const query of [
      `workspace_id=${a.workspaceId}&limit=100`,
      `workspace_id=${a.workspaceId}&q=quokka`,
      `project_id=${a.projectId}&q=quokka`,
      `workspace_id=${a.workspaceId}&since=0&limit=100`,
      `workspace_id=${a.workspaceId}&status=open,quarantined,approved,proposed`,
    ]) {
      const res = await c.get(`/api/v1/entries?${query}`);
      expect(res.status).toBe(200);
      for (const e of res.body.entries as { workspace_id: string }[]) {
        expect(e.workspace_id).toBe(a.workspaceId);
      }
      expect(res.text).not.toContain(bIds.title);
    }
  });

  it("the context packet for A holds nothing of B", async () => {
    const res = await ctx.server
      .as(human(a.owner))
      .post("/api/v1/context", { scope: a.feat, task: "quokka isolation" });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(bIds.title);
    expect(res.text).not.toContain(bIds.decision);
  });

  // "An agent acting for an owner of A gets the same 404 from every route an agent may call
  // (the humans-only routes answer it `humans_only` for every id, B's or not)."
  it("an agent for an owner of A gets 404 from every agent route and humans_only from the rest", async () => {
    const before = await snapshot(ctx.db, b.workspaceId);
    const c = ctx.server.as(agent(a.owner));
    expectAllNotFound(await agentRoutes(c));
    for (const id of [
      bIds.decision,
      bIds.proposed,
      bIds.quarantined,
      bIds.question,
    ]) {
      for (const action of ["approve", "reject", "release"]) {
        expectError(
          await c.post(`/api/v1/entries/${id}/${action}`),
          403,
          "humans_only",
        );
      }
      expectError(
        await c.post(`/api/v1/entries/${id}/answer`, { body: "b" }),
        403,
        "humans_only",
      );
    }
    expectError(
      await c.get(`/api/v1/workspaces/${b.workspaceId}/export`),
      403,
      "humans_only",
    );
    expectError(
      await c.delete(`/api/v1/workspaces/${b.workspaceId}`, {
        confirm: b.name,
      }),
      403,
      "humans_only",
    );
    expect(await snapshot(ctx.db, b.workspaceId)).toEqual(before);
  });

  it("B's own owner still reaches B's entries", async () => {
    const res = await ctx.server
      .as(human(b.owner))
      .get(`/api/v1/entries/${bIds.decision}`);
    expect(res.status).toBe(200);
    expect(res.body.entry.title).toBe(bIds.title);
  });
});
