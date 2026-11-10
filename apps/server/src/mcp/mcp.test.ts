// /mcp behind the bearer check (spec.md Edge cases, rows for ticket 05): only a JWT signed by our
// key, from our issuer, for `<url>/mcp`, unexpired and in the Authorization header gets through;
// the caller is an agent acting for the token's subject, and whoami lists only their workspaces.
import type { Actor } from "@sky-brain/shared/actor";
import { eq } from "drizzle-orm";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorMiddleware } from "../actor/middleware.ts";
import { requireHuman } from "../actor/require-human.ts";
import { invites, members } from "../db/schema.ts";
import { errorHandler } from "../http/error-handler.ts";
import {
  startAuthTestServer,
  type AuthTestServer,
} from "../testing/auth-harness.ts";
import { closeTestDb, createTestDb, type Db } from "../testing/harness.ts";
import { actorFromMcpClaims } from "./actor.ts";
import {
  CIMD_DOCUMENTS,
  CLAUDE_AI_CLIENT,
  callWhoami,
  decodeJwt,
  expectChallenge,
  mcpInitialize,
  mcpPost,
  signInAndGetToken,
} from "./test-flow.ts";

let db: Db;
let server: AuthTestServer;
/** A real access token from the flow, and whose it is. */
let good: { token: string; sub: string; email: string };

const ann = {
  subjectId: "subject-ann",
  email: "ann@example.test",
  firstName: "Ann",
};

beforeAll(async () => {
  db = await createTestDb();
  server = await startAuthTestServer({ db, cimdDocuments: CIMD_DOCUMENTS });
  const { accessToken } = await signInAndGetToken(server, { account: ann });
  good = {
    token: accessToken,
    sub: decodeJwt(accessToken).sub as string,
    email: ann.email,
  };
}, 60_000);

afterAll(async () => {
  if (server) await server.close();
  if (db) await closeTestDb(db);
});

const now = () => Math.floor(Date.now() / 1000);

/** Claims like a real access token's, signed with the server's own key. */
function claims(overrides: Record<string, unknown> = {}) {
  return {
    sub: good.sub,
    azp: CLAUDE_AI_CLIENT,
    iss: `${server.url}/api/auth`,
    aud: `${server.url}/mcp`,
    scope: "openid brain:read",
    iat: now(),
    exp: now() + 300,
    ...overrides,
  };
}

describe("mcp", () => {
  it("mcp: no token answers 401 with the resource_metadata challenge", async () => {
    for (const method of ["POST", "GET", "DELETE"]) {
      const res = await server.browser().request("/mcp", {
        method,
        headers: { accept: "application/json, text/event-stream" },
        ...(method === "POST"
          ? {
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/list",
              }),
            }
          : {}),
      });
      expectChallenge(server, res);
    }
    // The control: the same server lets a token with the right claims through.
    const signed = await server.signJwt(claims());
    expect((await mcpInitialize(server, signed)).status).toBe(200);
  });

  it("mcp: a token for another audience is refused", async () => {
    const other = await server.signJwt(
      claims({ aud: `${server.url}/api/auth` }),
    );
    expectChallenge(server, await mcpInitialize(server, other));

    // The jwt plugin's session JWT, minted with the same keys for another audience.
    const { browser } = await signInAndGetToken(server, { account: ann });
    const session = await browser.request("/api/auth/token");
    expect(session.status).toBe(200);
    expect(typeof session.body.token).toBe("string");
    expectChallenge(
      server,
      await mcpInitialize(server, session.body.token as string),
    );
  });

  it("mcp: an expired token is refused", async () => {
    const expired = await server.signJwt(
      claims({ iat: now() - 600, exp: now() - 300 }),
    );
    expectChallenge(server, await mcpInitialize(server, expired));
  });

  it("mcp: a token from another issuer is refused", async () => {
    const foreign = await server.signJwt(
      claims({ iss: "https://evil.test/api/auth" }),
    );
    expectChallenge(server, await mcpInitialize(server, foreign));
  });

  it("mcp: a tampered token is refused", async () => {
    const [header, payload, signature] = good.token.split(".");
    const altered = Buffer.from(
      JSON.stringify({ ...decodeJwt(good.token), sub: "someone-else" }),
    ).toString("base64url");
    expect(altered).not.toBe(payload);
    expectChallenge(
      server,
      await mcpInitialize(server, `${header}.${altered}.${signature}`),
    );
    // A flipped signature character on the untouched payload, too.
    const sig = signature!;
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expectChallenge(
      server,
      await mcpInitialize(server, `${header}.${payload}.${flipped}`),
    );
  });

  it("mcp: a token in the query string is refused", async () => {
    const res = await mcpPost(
      server,
      undefined,
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.0" },
      },
      `/mcp?access_token=${encodeURIComponent(good.token)}`,
    );
    expectChallenge(server, res);
  });

  it("mcp: whoami ignores arguments that name someone else", async () => {
    const me = await callWhoami(server, good.token, {
      email: "x@evil.test",
      user_id: "someone-else",
    });
    expect(me.email).toBe(good.email);
    expect(me.user_id).toBe(good.sub);
  });

  it("mcp: whoami lists every workspace of the caller and no other", async () => {
    const owner = {
      subjectId: "subject-owner",
      email: "owner@example.test",
    };
    const editor = {
      subjectId: "subject-editor",
      email: "editor@example.test",
    };
    const third = { subjectId: "subject-third", email: "third@example.test" };

    const ownerToken = (await signInAndGetToken(server, { account: owner }))
      .accessToken;
    const ownerId = decodeJwt(ownerToken).sub as string;
    const [ownerWs] = await db
      .select({ id: members.workspaceId })
      .from(members)
      .where(eq(members.userId, ownerId));
    await db.insert(invites).values({
      workspaceId: ownerWs!.id,
      email: editor.email,
      role: "editor",
      invitedBy: ownerId,
    });

    // The invite is accepted at the editor's sign-in (ticket 03).
    const editorToken = (await signInAndGetToken(server, { account: editor }))
      .accessToken;
    const thirdToken = (await signInAndGetToken(server, { account: third }))
      .accessToken;

    const o = await callWhoami(server, ownerToken);
    expect(o.email).toBe(owner.email);
    expect(o.workspaces).toEqual([
      { id: ownerWs!.id, name: owner.email, role: "owner" },
    ]);

    const e = await callWhoami(server, editorToken);
    expect(e.email).toBe(editor.email);
    expect(e.workspaces).toHaveLength(2);
    const editorOwn = e.workspaces.find((w) => w.role === "owner");
    expect(editorOwn?.name).toBe(editor.email);
    expect(e.workspaces).toContainEqual({
      id: ownerWs!.id,
      name: owner.email,
      role: "editor",
    });

    const t = await callWhoami(server, thirdToken);
    expect(t.email).toBe(third.email);
    expect(t.workspaces).toHaveLength(1);
    expect(t.workspaces[0]!.role).toBe("owner");
    expect(t.workspaces[0]!.name).toBe(third.email);
    // Refused: nobody sees a workspace they are not a member of (hard rule 4).
    const ids = (r: typeof t) => r.workspaces.map((w) => w.id);
    expect(ids(t)).not.toContain(ownerWs!.id);
    expect(ids(t)).not.toContain(editorOwn!.id);
    expect(ids(o)).not.toContain(editorOwn!.id);
    expect(ids(o)).not.toContain(t.workspaces[0]!.id);
    expect(ids(e)).not.toContain(t.workspaces[0]!.id);
  });

  it("mcp: an MCP caller is an agent and requireHuman refuses it", async () => {
    const agent = actorFromMcpClaims({
      sub: "user123",
      azp: "https://Claude.AI/oauth/client.json",
    });
    expect(agent).toEqual({
      kind: "agent",
      agent_id: "mcp/claude.ai",
      on_behalf_of: "user123",
    });
    // No actor from claims that do not name a person and an HTTPS client.
    for (const bad of [
      { azp: CLAUDE_AI_CLIENT },
      { sub: "user123" },
      { sub: "user123", azp: "http://claude.ai/oauth/client.json" },
      { sub: "user123", azp: "not a url" },
      { sub: "user123", azp: 42 },
      { sub: "has spaces!", azp: CLAUDE_AI_CLIENT },
      { sub: "", azp: CLAUDE_AI_CLIENT },
    ]) {
      expect(actorFromMcpClaims(bad)).toBeUndefined();
    }

    const human: Actor = { kind: "human", user_id: "user123" };
    const status = async (actor: Actor) => {
      const app = express();
      app.use(
        actorMiddleware({ resolveActor: () => actor, devActorHeader: false }),
      );
      app.post("/rules", requireHuman, (_req, res) => {
        res.status(200).json({ ok: true });
      });
      app.use(errorHandler);
      const http: Server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      try {
        const port = (http.address() as AddressInfo).port;
        const res = await fetch(`http://127.0.0.1:${port}/rules`, {
          method: "POST",
        });
        return { status: res.status, body: await res.json() };
      } finally {
        await new Promise((r) => http.close(r));
      }
    };
    const refused = await status(agent!);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("humans_only");
    const allowed = await status(human);
    expect(allowed.status).toBe(200);
  });
});
