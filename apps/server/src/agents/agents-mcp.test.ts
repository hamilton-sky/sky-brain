// An agent profile reaches /mcp (D25 part 1): the role comes from the person's binding on the
// server, shows in whoami, and is the author of what the agent writes. Unbound, it is the Guest.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entries } from "@sky-brain/db/schema";
import {
  startAuthTestServer,
  type AuthTestServer,
} from "../testing/auth-harness.ts";
import { closeTestDb, createTestDb, type Db } from "../testing/harness.ts";
import {
  CIMD_DOCUMENTS,
  CLAUDE_AI_CLIENT,
  callWhoami,
  decodeJwt,
  mcpPost,
  signInAndGetToken,
} from "../mcp/test/flow.ts";
import { bindApp, createProfile } from "./profiles.ts";

let db: Db;
let server: AuthTestServer;
let token: string;
let sub: string;

beforeAll(async () => {
  db = await createTestDb();
  server = await startAuthTestServer({ db, cimdDocuments: CIMD_DOCUMENTS });
  const { accessToken } = await signInAndGetToken(server, {
    account: {
      subjectId: "subject-ann",
      email: "ann@example.test",
      firstName: "Ann",
    },
  });
  token = accessToken;
  sub = decodeJwt(accessToken).sub as string;
}, 60_000);

afterAll(async () => {
  if (server) await server.close();
  if (db) await closeTestDb(db);
});

describe("agent profiles over MCP", () => {
  it("an unbound app is the Guest agent", async () => {
    const me = await callWhoami(server, token);
    expect(me.agent).toEqual({ agent_id: "mcp/claude.ai.test", profile: null });
  });

  it("a bound app acts as its profile, and its writes carry the role", async () => {
    const po = await createProfile(db, sub, {
      slug: "po",
      display_name: "Product owner",
      kind: "worker",
    });
    expect(await bindApp(db, sub, CLAUDE_AI_CLIENT, po!.id)).toBe("bound");

    const me = await callWhoami(server, token);
    expect(me.agent).toEqual({
      agent_id: "mcp/claude.ai.test/po",
      profile: { id: po!.id, slug: "po", display_name: "Product owner" },
    });

    const res = await mcpPost(server, token, "tools/call", {
      name: "capture",
      arguments: {
        kind: "fact",
        title: "Profiles work",
        body: "The PO wrote this.",
        summary: "A note written by the PO profile.",
      },
    });
    expect(res.status).toBe(200);
    const rows = await db
      .select({ author: entries.author, kind: entries.authorKind })
      .from(entries)
      .where(eq(entries.title, "Profiles work"));
    expect(rows).toEqual([{ author: "mcp/claude.ai.test/po", kind: "agent" }]);
  });

  it("unbinding returns the app to the Guest agent at the next call", async () => {
    expect(await bindApp(db, sub, CLAUDE_AI_CLIENT, null)).toBe("unbound");
    const me = await callWhoami(server, token);
    expect(me.agent?.profile).toBeNull();
  });
});
