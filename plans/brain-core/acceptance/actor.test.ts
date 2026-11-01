// Edge cases about the actor (Check order step 1) and the dev actor header.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer } from "../../../apps/server/src/testing/harness.ts";
import {
  AGENT_ID,
  agent,
  entry,
  entryRows,
  expectError,
  human,
  seedWorld,
  setup,
  type Server,
  type World,
} from "./helpers.ts";

const ctx = setup();
let devServer: Server;
let w: World;

beforeAll(async () => {
  w = await seedWorld(ctx.db);
  devServer = await startTestServer({
    db: ctx.db,
    devActorHeader: true,
    rateLimit: { capacity: 100_000, refillPerSecond: 100_000 },
  });
}, 60_000);

afterAll(async () => {
  if (devServer) await devServer.close();
}, 60_000);

const json = { "content-type": "application/json" };

describe("no actor", () => {
  // Edge: "No actor on an `/api/v1` request | 401 `unauthenticated`, even with a malformed or
  // oversized body (the actor is checked first)"
  it("answers 401 unauthenticated with no actor", async () => {
    expectError(
      await ctx.server.anonymous.get(
        `/api/v1/entries?project_id=${w.projectId}`,
      ),
      401,
      "unauthenticated",
    );
    expectError(
      await ctx.server.anonymous.post("/api/v1/entries", entry(w.proj, "note")),
      401,
      "unauthenticated",
    );
    expectError(
      await ctx.server.anonymous.post("/api/v1/context", { scope: w.proj }),
      401,
      "unauthenticated",
    );
  });

  it("answers 401 unauthenticated with no actor even for a malformed body", async () => {
    const res = await ctx.server.anonymous.request("/api/v1/entries", {
      method: "POST",
      headers: json,
      body: "{not json",
    });
    expectError(res, 401, "unauthenticated");
  });

  it("answers 401 unauthenticated with no actor even for an oversized body", async () => {
    const res = await ctx.server.anonymous.request("/api/v1/entries", {
      method: "POST",
      headers: json,
      body: JSON.stringify(
        entry(w.proj, "note", { body: "x".repeat(70 * 1024) }),
      ),
    });
    expectError(res, 401, "unauthenticated");
  });

  it("stores nothing for an anonymous write", async () => {
    const before = (await entryRows(ctx.db, w.workspaceId)).length;
    await ctx.server.anonymous.post("/api/v1/entries", entry(w.proj, "note"));
    expect((await entryRows(ctx.db, w.workspaceId)).length).toBe(before);
  });
});

describe("dev header off", () => {
  // Edge: "`X-Dev-Actor` sent while the dev header is off (any NODE_ENV but `development`) |
  // 401 `dev_actor_disabled`, even with a valid actor otherwise"
  it("answers 401 dev_actor_disabled to a request carrying X-Dev-Actor", async () => {
    const res = await ctx.server.anonymous.request("/api/v1/entries", {
      method: "POST",
      headers: { ...json, "X-Dev-Actor": JSON.stringify(human(w.owner)) },
      body: JSON.stringify(entry(w.proj, "note")),
    });
    expectError(res, 401, "dev_actor_disabled");
  });

  it("answers 401 dev_actor_disabled even when the request has a valid actor otherwise", async () => {
    const before = (await entryRows(ctx.db, w.workspaceId)).length;
    const res = await ctx.server.as(human(w.owner)).request("/api/v1/entries", {
      method: "POST",
      headers: { ...json, "X-Dev-Actor": JSON.stringify(human(w.owner)) },
      body: JSON.stringify(entry(w.proj, "note")),
    });
    expectError(res, 401, "dev_actor_disabled");
    expect((await entryRows(ctx.db, w.workspaceId)).length).toBe(before);
  });
});

describe("dev header on", () => {
  // Edge: "`X-Dev-Actor` not a valid actor JSON | 401 `invalid_dev_actor`"
  it("answers 401 invalid_dev_actor to a header that is not JSON", async () => {
    const res = await devServer.anonymous.request(
      `/api/v1/entries?project_id=${w.projectId}`,
      {
        headers: { "X-Dev-Actor": "not json" },
      },
    );
    expectError(res, 401, "invalid_dev_actor");
  });

  it("answers 401 invalid_dev_actor to JSON that is not a valid actor", async () => {
    for (const bad of [
      { kind: "robot", user_id: w.owner },
      { kind: "human" },
      { kind: "agent", agent_id: AGENT_ID },
      { kind: "agent", agent_id: "Bad Agent!", on_behalf_of: w.owner },
      { kind: "human", user_id: "has space" },
    ]) {
      const res = await devServer.anonymous.request(
        `/api/v1/entries?project_id=${w.projectId}`,
        {
          headers: { "X-Dev-Actor": JSON.stringify(bad) },
        },
      );
      expectError(res, 401, "invalid_dev_actor");
    }
  });

  // Interfaces -> Dev actor header: "Honoured only when the dev header is on"
  it("takes the actor from a valid X-Dev-Actor header", async () => {
    const res = await devServer.anonymous.request("/api/v1/entries", {
      method: "POST",
      headers: { ...json, "X-Dev-Actor": JSON.stringify(agent(w.editor)) },
      body: JSON.stringify(entry(w.proj, "note")),
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.author_kind).toBe("agent");
    expect(res.body.entry.author).toBe(AGENT_ID);
    expect(res.body.entry.on_behalf_of).toBe(w.editor);
    expect(res.body.entry.status).toBe("proposed");
  });
});
