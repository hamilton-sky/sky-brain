// The book of this brain over MCP (BOOK.md 11 step 1): server instructions in `initialize`, the
// `book` and `context` tools listed, every description with "Use when", the contents with a live
// "Your brain now", a chapter found by tool name, and the chapters in step with docs/vision/book.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startAuthTestServer,
  type AuthTestServer,
} from "../testing/auth-harness.ts";
import { closeTestDb, createTestDb, type Db } from "../testing/harness.ts";
import { BOOK_CHAPTERS } from "./book-chapters.ts";
import { serverInstructions } from "./book-tool.ts";
import {
  callTool,
  CIMD_DOCUMENTS,
  mcpInitialize,
  mcpPost,
  rpcResult,
  signInAndGetToken,
} from "./test/flow.ts";

let db: Db;
let server: AuthTestServer;
let token: string;

beforeAll(async () => {
  db = await createTestDb();
  server = await startAuthTestServer({ db, cimdDocuments: CIMD_DOCUMENTS });
  ({ accessToken: token } = await signInAndGetToken(server, {
    account: {
      subjectId: "subject-ann",
      email: "ann@example.test",
      firstName: "ann",
    },
  }));
}, 60_000);

afterAll(async () => {
  await server?.close();
  if (db) await closeTestDb(db);
});

const tool = (name: string, args: Record<string, unknown>) =>
  callTool(server, token, name, args);

describe("mcp book", () => {
  it("initialize carries the server instructions, under 512 characters", async () => {
    const init = await mcpInitialize(server, token);
    const result = rpcResult(init).result as { instructions?: string };
    expect(result.instructions).toBe(serverInstructions(true));
    expect(result.instructions!.length).toBeLessThanOrEqual(512);
    expect(serverInstructions(false)).not.toMatch(/context/);
  });

  it("lists book and context, and every tool says when to use it", async () => {
    await mcpInitialize(server, token);
    const res = await mcpPost(server, token, "tools/list", {});
    const tools = (
      rpcResult(res).result as unknown as {
        tools: { name: string; description?: string }[];
      }
    ).tools;
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["book", "context"]));
    for (const t of tools) expect(t.description).toMatch(/Use when/);
  });

  it("book with no id gives the contents with this brain now", async () => {
    await tool("capture", {
      kind: "fact",
      title: "Likes metric",
      body: "Ann uses metric units.",
      summary: "Ann uses metric units.",
    });
    const { isError, body } = await tool("book", {});
    expect(isError).toBe(false);
    expect(body).toMatch(/## Your brain now/);
    expect(body).toMatch(/\| About me \|/);
    expect(body).toMatch(/\| Boards \|/);
    expect(body).not.toMatch(/\{person\}|\{role\}|\{app\}/);
  });

  it("book by chapter id or tool name gives that chapter", async () => {
    expect((await tool("book", { id: "approval" })).body).toBe(
      BOOK_CHAPTERS.approval!.replace("`{version}`", "`1`"),
    );
    const claim = (await tool("book", { id: "claim_task" })).body as string;
    expect(claim).toMatch(/\*\*claim_task\*\*/);
    expect((await tool("book", { id: "nope" })).body).toMatch(
      /No chapter or tool "nope"/,
    );
  });

  it("context answers a question across layers", async () => {
    const { isError, body } = await tool("context", { q: "metric units" });
    expect(isError).toBe(false);
    expect(body.context.text).toMatch(/metric/);
  });

  it("the chapters match docs/vision/book (run pnpm book:gen)", () => {
    const dir = join(import.meta.dirname, "../../../../docs/vision/book");
    const files = readdirSync(dir).filter((f) => /^\d\d-.*\.md$/.test(f));
    expect(Object.keys(BOOK_CHAPTERS).length).toBe(files.length);
    const texts = new Set(Object.values(BOOK_CHAPTERS));
    for (const f of files)
      expect(texts.has(readFileSync(join(dir, f), "utf8"))).toBe(true);
  });
});
