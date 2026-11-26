// An agent profile reaches /mcp (D25 part 1): the role comes from the person's binding on the
// server, shows in whoami, and is the author of what the agent writes. Unbound, it is the Guest.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  coreEntryHats,
  entries,
  entryVersions,
  hats,
  members,
  memories,
} from "@sky-brain/db/schema";
import {
  startAuthTestServer,
  type AuthTestServer,
} from "../testing/auth-harness.ts";
import {
  closeTestDb,
  createTestDb,
  seedEntry,
  type Db,
} from "../testing/harness.ts";
import {
  CIMD_DOCUMENTS,
  CLAUDE_AI_CLIENT,
  callWhoami,
  decodeJwt,
  mcpPost,
  rpcResult,
  signInAndGetToken,
} from "../mcp/test/flow.ts";
import { bindHat, createHat } from "./hats.ts";
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

describe("hats over MCP (D42)", () => {
  it("an unbound app has no hat and sees every hat of the brain", async () => {
    const [m] = await db
      .select({ ws: members.workspaceId })
      .from(members)
      .where(eq(members.userId, sub));
    const work = await createHat(db, m!.ws, {
      slug: "work",
      name: "Work",
      description: "The job.",
    });
    await createHat(db, m!.ws, { slug: "home", name: "Home", description: "" });
    const me = await callWhoami(server, token);
    expect(me.hat).toBeNull();
    expect(me.hats?.map((h) => h.slug)).toEqual(["work", "home"]);

    expect(await bindHat(db, sub, m!.ws, CLAUDE_AI_CLIENT, work!.id)).toBe(
      "bound",
    );
  });

  it("a bound app works under its hat: whoami shows only it, and writes record it", async () => {
    const me = await callWhoami(server, token);
    expect(me.hat).toMatchObject({ slug: "work", name: "Work" });
    expect(me.hats?.map((h) => h.slug)).toEqual(["work"]);

    const res = await mcpPost(server, token, "tools/call", {
      name: "capture",
      arguments: {
        kind: "fact",
        title: "Written at work",
        body: "Under the Work hat.",
        summary: "A note written under the Work hat.",
      },
    });
    expect(res.status).toBe(200);
    const [row] = await db
      .select({ hat: entryVersions.captureHatId })
      .from(entryVersions)
      .innerJoin(entries, eq(entries.id, entryVersions.entryId))
      .where(eq(entries.title, "Written at work"));
    expect(row!.hat).toBe(me.hat!.id);
  });
});

/** One tool call: its structured result, or the error text when the tool refused. */
async function tool(name: string, args: Record<string, unknown>) {
  const res = await mcpPost(server, token, "tools/call", {
    name,
    arguments: args,
  });
  const { result } = rpcResult(res);
  return result.isError
    ? { error: result.content?.[0]?.text ?? "" }
    : (result.structuredContent as Record<string, unknown>);
}

const titles = (r: Record<string, unknown>) =>
  ((r.entries ?? []) as { title: string }[]).map((e) => e.title).sort();

describe("reads under a hat (D44)", () => {
  let homeEntry: string;
  beforeAll(async () => {
    const [m] = await db
      .select({ ws: members.workspaceId })
      .from(members)
      .where(eq(members.userId, sub));
    const ws = m!.ws;
    const byslug = async (slug: string) =>
      (
        await db
          .select({ id: hats.id })
          .from(hats)
          .where(and(eq(hats.workspaceId, ws), eq(hats.slug, slug)))
      )[0]!.id;
    const [homeBook] = await db
      .insert(memories)
      .values({
        workspaceId: ws,
        layer: "long",
        name: "Home notes",
        hatId: await byslug("home"),
      })
      .returning({ id: memories.id });
    const [workBook] = await db
      .insert(memories)
      .values({
        workspaceId: ws,
        layer: "long",
        name: "Work notes",
        hatId: await byslug("work"),
      })
      .returning({ id: memories.id });
    homeEntry = (
      await seedEntry(db, {
        workspaceId: ws,
        memoryId: homeBook!.id,
        layer: "long",
        title: "Zebra at home",
        body: "zebra home",
      })
    ).id;
    await seedEntry(db, {
      workspaceId: ws,
      memoryId: workBook!.id,
      layer: "long",
      title: "Zebra at work",
      body: "zebra work",
    });
    await seedEntry(db, {
      workspaceId: ws,
      layer: "long",
      title: "Zebra shared",
      body: "zebra everywhere",
    });
    const kids = await seedEntry(db, {
      workspaceId: ws,
      layer: "core",
      title: "Zebra kids",
      body: "zebra two kids",
    });
    await db.insert(coreEntryHats).values({
      entryId: kids.id,
      hatId: await byslug("home"),
      workspaceId: ws,
    });
  });

  it("an app bound to Work sees shared and Work only, and cannot wear another hat", async () => {
    expect(titles(await tool("search", { q: "zebra" }))).toEqual([
      "Zebra at work",
      "Zebra shared",
    ]);
    expect(await tool("get", { entry_id: homeEntry })).toMatchObject({
      error: expect.stringContaining("not_found"),
    });
    const listed = (await tool("list_memories", {})).memories as {
      name: string;
    }[];
    expect(listed.map((x) => x.name)).toContain("Work notes");
    expect(listed.map((x) => x.name)).not.toContain("Home notes");
    const packet = (await tool("context", { q: "zebra" })).context as {
      text: string;
    };
    expect(packet.text).not.toContain("Zebra kids");
    expect(packet.text).not.toContain("Zebra at home");
    expect(await tool("search", { q: "zebra", hat: "home" })).toMatchObject({
      error: expect.stringContaining("hat_bound"),
    });
  });

  it("an unbound app sees everything, or wears the hat it picks for the call", async () => {
    const [m] = await db
      .select({ ws: members.workspaceId })
      .from(members)
      .where(eq(members.userId, sub));
    expect(await bindHat(db, sub, m!.ws, CLAUDE_AI_CLIENT, null)).toBe(
      "unbound",
    );
    expect(titles(await tool("search", { q: "zebra", layer: "long" }))).toEqual(
      ["Zebra at home", "Zebra at work", "Zebra shared"],
    );
    expect(titles(await tool("search", { q: "zebra", hat: "home" }))).toEqual([
      "Zebra at home",
      "Zebra kids",
      "Zebra shared",
    ]);
    const packet = (await tool("context", { q: "zebra", hat: "work" }))
      .context as { text: string };
    expect(packet.text).not.toContain("Zebra at home");
    expect(await tool("search", { q: "zebra", hat: "nope" })).toMatchObject({
      error: expect.stringContaining("no_such_hat"),
    });
  });
});
