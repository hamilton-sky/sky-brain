// `/api/v1/agents` (D25 part 1): only a person manages profiles and bindings, each person sees
// only their own, and an app can be bound only by the person who connected it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { oauthClient, oauthConsent, user } from "@sky-brain/db/schema";
import {
  closeTestDb,
  createTestDb,
  startTestServer,
  type Db,
  type TestServer,
} from "../testing/harness.ts";

let db: Db;
let server: TestServer;

const APP = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const OTHER_APP = "https://other.test/client.json";
const human = (user_id: string) => ({ kind: "human" as const, user_id });
const agent = (on_behalf_of: string) => ({
  kind: "agent" as const,
  agent_id: "mcp/claude.ai",
  on_behalf_of,
});

async function seedPersonWithApp(id: string, clientId: string) {
  await db
    .insert(user)
    .values({ id, name: id, email: `${id}@example.test` })
    .onConflictDoNothing();
  await db
    .insert(oauthClient)
    .values({
      id: `client-${clientId}`,
      clientId,
      name: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    })
    .onConflictDoNothing();
  const now = new Date();
  await db.insert(oauthConsent).values({
    id: `consent-${id}-${clientId}`,
    clientId,
    userId: id,
    scopes: ["openid", "brain:read"],
    createdAt: now,
    updatedAt: now,
  });
}

beforeAll(async () => {
  db = await createTestDb();
  server = await startTestServer({ db });
  await seedPersonWithApp("ann", APP);
  await seedPersonWithApp("bob", OTHER_APP);
}, 60_000);

afterAll(async () => {
  if (server) await server.close();
  if (db) await closeTestDb(db);
});

describe("agent profiles", () => {
  let po: string;

  it("a person creates a profile and sees it with their connected apps", async () => {
    const res = await server.as(human("ann")).post("/api/v1/agents/profiles", {
      slug: "po",
      display_name: "Product owner",
    });
    expect(res.status).toBe(201);
    expect(res.body.profile).toMatchObject({ slug: "po", kind: "worker" });
    po = res.body.profile.id;

    const list = await server.as(human("ann")).get("/api/v1/agents");
    expect(list.status).toBe(200);
    expect(list.body.profiles.map((p: { slug: string }) => p.slug)).toEqual([
      "po",
    ]);
    expect(list.body.apps).toEqual([
      { client_id: APP, name: "Claude", profile_id: null },
    ]);
  });

  it("a taken slug is 409 and a bad slug is 400", async () => {
    const taken = await server
      .as(human("ann"))
      .post("/api/v1/agents/profiles", { slug: "po", display_name: "Again" });
    expect(taken.status).toBe(409);
    const bad = await server
      .as(human("ann"))
      .post("/api/v1/agents/profiles", { slug: "PO!", display_name: "Bad" });
    expect(bad.status).toBe(400);
  });

  it("an agent can neither read, create, bind nor delete profiles", async () => {
    const as = server.as(agent("ann"));
    for (const res of [
      await as.get("/api/v1/agents"),
      await as.post("/api/v1/agents/profiles", {
        slug: "boss",
        display_name: "Boss",
      }),
      await as.post("/api/v1/agents/bind", { client_id: APP, profile_id: po }),
      await as.delete(`/api/v1/agents/profiles/${po}`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("humans_only");
    }
  });

  it("another person sees none of them and cannot bind or delete them", async () => {
    const list = await server.as(human("bob")).get("/api/v1/agents");
    expect(list.body.profiles).toEqual([]);
    expect(
      list.body.apps.map((a: { client_id: string }) => a.client_id),
    ).toEqual([OTHER_APP]);
    const bind = await server
      .as(human("bob"))
      .post("/api/v1/agents/bind", { client_id: OTHER_APP, profile_id: po });
    expect(bind.status).toBe(404);
    const del = await server
      .as(human("bob"))
      .delete(`/api/v1/agents/profiles/${po}`);
    expect(del.status).toBe(404);
  });

  it("a person binds only an app they connected", async () => {
    const other = await server
      .as(human("ann"))
      .post("/api/v1/agents/bind", { client_id: OTHER_APP, profile_id: po });
    expect(other.status).toBe(404);

    const ok = await server
      .as(human("ann"))
      .post("/api/v1/agents/bind", { client_id: APP, profile_id: po });
    expect(ok.status).toBe(200);
    const list = await server.as(human("ann")).get("/api/v1/agents");
    expect(list.body.apps[0].profile_id).toBe(po);

    const unbind = await server
      .as(human("ann"))
      .post("/api/v1/agents/bind", { client_id: APP, profile_id: null });
    expect(unbind.status).toBe(200);
    const after = await server.as(human("ann")).get("/api/v1/agents");
    expect(after.body.apps[0].profile_id).toBeNull();
  });

  it("deleting a profile unbinds its apps", async () => {
    await server
      .as(human("ann"))
      .post("/api/v1/agents/bind", { client_id: APP, profile_id: po });
    const del = await server
      .as(human("ann"))
      .delete(`/api/v1/agents/profiles/${po}`);
    expect(del.status).toBe(204);
    const list = await server.as(human("ann")).get("/api/v1/agents");
    expect(list.body.profiles).toEqual([]);
    expect(list.body.apps[0].profile_id).toBeNull();
  });
});
