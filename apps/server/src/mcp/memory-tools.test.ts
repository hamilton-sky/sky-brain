// The MCP memory tools end to end (BUILD-PLAN step 1): a real OAuth access token, the tools
// listed, a capture that lands in the Inbox as proposed, search and get, and another person's
// brain refused. There is no tool to approve, reject or revise.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startAuthTestServer,
  type AuthTestServer,
} from "../testing/auth-harness.ts";
import { closeTestDb, createTestDb, type Db } from "../testing/harness.ts";
import {
  callTool,
  CIMD_DOCUMENTS,
  signInAndGetToken,
  toolNames,
} from "./test/flow.ts";

let db: Db;
let server: AuthTestServer;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDb();
  server = await startAuthTestServer({ db, cimdDocuments: CIMD_DOCUMENTS });
  for (const name of ["ann", "bob"]) {
    const { accessToken } = await signInAndGetToken(server, {
      account: {
        subjectId: `subject-${name}`,
        email: `${name}@example.test`,
        firstName: name,
      },
    });
    tokens[name] = accessToken;
  }
}, 60_000);

afterAll(async () => {
  await server?.close();
  if (db) await closeTestDb(db);
});

const tool = (who: string, name: string, args: Record<string, unknown>) =>
  callTool(server, tokens[who]!, name, args);

const capture = {
  kind: "decision",
  title: "Sharing waits for step 8",
  body: "We said no to sharing memories before step 8 until the measure gate.",
  summary: "No sharing before step 8.",
  questions: ["When does sharing come?"],
};

describe("mcp memory tools", () => {
  it("lists capture, search, get and list_memories, and nothing that approves", async () => {
    const names = await toolNames(server, tokens.ann!);
    expect(names).toEqual(
      expect.arrayContaining(["capture", "search", "get", "list_memories"]),
    );
    for (const name of names) expect(name).not.toMatch(/approve|reject|revise/);
  });

  it("list_memories shows the person's About me, Inbox and Notebook", async () => {
    const { body } = await tool("ann", "list_memories", {});
    expect(body.memories.map((m: { layer: string }) => m.layer).sort()).toEqual(
      ["core", "long", "short"],
    );
  });

  it("capture lands in the Inbox as proposed; search and get find it", async () => {
    const saved = await tool("ann", "capture", capture);
    expect(saved.isError).toBe(false);
    expect(saved.body.entry).toMatchObject({
      layer: "short",
      trust: "proposed",
      author_kind: "agent",
    });
    const found = await tool("ann", "search", { q: "sharing step" });
    expect(found.body.entries[0].id).toBe(saved.body.entry.id);
    const got = await tool("ann", "get", { entry_id: saved.body.entry.id });
    expect(got.body.entry.body).toBe(capture.body);
    expect(got.body.versions).toHaveLength(1);
  });

  it("capture without a summary is refused", async () => {
    const { isError } = await tool("ann", "capture", {
      ...capture,
      summary: undefined,
    });
    expect(isError).toBe(true);
  });

  it("another person's agent finds nothing of it and cannot get it", async () => {
    const saved = await tool("ann", "capture", {
      ...capture,
      title: "Ann only",
    });
    const found = await tool("bob", "search", { q: "sharing step" });
    expect(found.body.entries).toHaveLength(0);
    const got = await tool("bob", "get", { entry_id: saved.body.entry.id });
    expect(got.isError).toBe(true);
    expect(got.body.status).toBe(404);
  });
});
