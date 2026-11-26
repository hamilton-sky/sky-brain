// The everyday MCP tools (D45) end to end with real OAuth tokens: an agent creates and renames a
// project and comments on an entry for its person; another person's project and entry are 404,
// and there is still no tool that resolves or deletes a comment (hard rule 3).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, toolNames } from "./test/flow.ts";
import { startWithPeople } from "./test/people.ts";

let mcp: Awaited<ReturnType<typeof startWithPeople>>;

beforeAll(async () => {
  mcp = await startWithPeople(["ann", "bob"]);
}, 60_000);

afterAll(async () => {
  await mcp?.close();
});

async function run(who: string, name: string, args: Record<string, unknown>) {
  const res = await callTool(mcp.server, mcp.tokens[who]!, name, args);
  expect(res.status).toBe(200);
  return res;
}

async function ownWorkspace(who: string): Promise<string> {
  const me = await run(who, "whoami", {});
  return me.body.workspaces[0].id;
}

describe("mcp everyday tools (D45)", () => {
  it("lists create_project, rename_project and comment, and nothing that resolves or deletes", async () => {
    const names = await toolNames(mcp.server, mcp.tokens.ann!);
    expect(names).toEqual(
      expect.arrayContaining(["create_project", "rename_project", "comment"]),
    );
    for (const n of names) expect(n).not.toMatch(/resolve|delete/);
  });

  it("an agent creates and renames a project for its person; another person's is 404", async () => {
    const created = await run("ann", "create_project", {
      workspace_id: await ownWorkspace("ann"),
      name: "Garden",
    });
    expect(created.isError).toBe(false);
    const project = created.body.project;
    expect(project.slug).toBe("garden");

    const renamed = await run("ann", "rename_project", {
      project_id: project.id,
      name: "Garden 2027",
    });
    expect(renamed.body.project).toMatchObject({
      slug: "garden",
      name: "Garden 2027",
    });

    const intruder = await run("bob", "rename_project", {
      project_id: project.id,
      name: "Mine",
    });
    expect(intruder.isError).toBe(true);
    expect(intruder.body.status).toBe(404);
    const elsewhere = await run("bob", "create_project", {
      workspace_id: await ownWorkspace("ann"),
      name: "Sneak",
    });
    expect(elsewhere.isError).toBe(true);
    expect(elsewhere.body.status).toBe(404);
  });

  it("an agent comments on its person's entry as itself; another person's entry is 404", async () => {
    const captured = await run("ann", "capture", {
      kind: "fact",
      title: "Tomatoes need sun",
      body: "Tomatoes need six hours of sun a day.",
      summary: "Tomatoes need sun.",
    });
    const entryId = captured.body.entry.id;
    const said = await run("ann", "comment", {
      entry_id: entryId,
      body: "Is six hours right for cherry tomatoes too?",
      quote: "six hours",
    });
    expect(said.isError).toBe(false);
    expect(said.body.comment).toMatchObject({
      author_kind: "agent",
      quote: "six hours",
    });

    const bobs = await run("bob", "comment", { entry_id: entryId, body: "Hi" });
    expect(bobs.isError).toBe(true);
    expect(bobs.body.status).toBe(404);
  });
});
