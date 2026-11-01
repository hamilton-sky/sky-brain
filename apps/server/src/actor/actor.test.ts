// The actor layer over HTTP (spec.md Interfaces -> Check order steps 1 to 3).
import type { Actor } from "@sky-brain/shared/actor";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorHandler } from "../http/error-handler.ts";
import {
  closeTestDb,
  createTestDb,
  startTestServer,
  type Db,
  type TestServer,
} from "../testing/harness.ts";
import { actorKey, auditActor, personOf } from "./keys.ts";
import { actorMiddleware, actorOf } from "./middleware.ts";
import { requireHuman } from "./require-human.ts";

const alice: Actor = { kind: "human", user_id: "alice" };
const builder: Actor = {
  kind: "agent",
  agent_id: "claude-code/builder",
  on_behalf_of: "alice",
};
const json = { "content-type": "application/json" };

let db: Db;
let off: TestServer;
let on: TestServer;

beforeAll(async () => {
  db = await createTestDb();
  off = await startTestServer({ db });
  on = await startTestServer({ db, devActorHeader: true });
}, 60_000);

afterAll(async () => {
  await off?.close();
  await on?.close();
  if (db) await closeTestDb(db);
}, 60_000);

describe("actor middleware", () => {
  it("refuses a request with no actor", async () => {
    for (const res of [
      await off.anonymous.get("/api/v1/entries"),
      await off.anonymous.post("/api/v1/entries", { title: "x" }),
      await on.anonymous.get("/api/v1/nothing-here"),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("unauthenticated");
    }
  });

  it("lets a known actor through, so an unknown path answers 404", async () => {
    const res = await off.as(alice).get("/api/v1/nothing-here");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("refuses an unknown bearer value", async () => {
    const res = await off.anonymous.request("/api/v1/nothing-here", {
      headers: { authorization: "Bearer not-a-token" },
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthenticated");
  });

  it("refuses the dev header when it is off", async () => {
    for (const client of [off.anonymous, off.as(alice)]) {
      const res = await client.request("/api/v1/nothing-here", {
        headers: { "X-Dev-Actor": JSON.stringify(alice) },
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("dev_actor_disabled");
    }
  });

  it("refuses a malformed dev header", async () => {
    for (const bad of [
      "not json",
      "",
      JSON.stringify({ kind: "robot", user_id: "alice" }),
      JSON.stringify({ kind: "human" }),
      JSON.stringify({ kind: "human", user_id: "has space" }),
      JSON.stringify({ kind: "human", user_id: "x".repeat(65) }),
      JSON.stringify({ kind: "agent", agent_id: "claude-code/builder" }),
      JSON.stringify({ kind: "agent", agent_id: "Bad!", on_behalf_of: "a" }),
      JSON.stringify({ kind: "agent", agent_id: "-x", on_behalf_of: "a" }),
    ]) {
      const res = await on.anonymous.request("/api/v1/nothing-here", {
        headers: { "X-Dev-Actor": bad },
      });
      expect(res.status, bad).toBe(401);
      expect(res.body.error.code, bad).toBe("invalid_dev_actor");
    }
  });

  it("accepts the dev header in development", async () => {
    for (const actor of [alice, builder]) {
      const res = await on.anonymous.request("/api/v1/nothing-here", {
        headers: { "X-Dev-Actor": JSON.stringify(actor) },
      });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("not_found");
    }
  });

  it("checks the actor before the body", async () => {
    const malformed = await off.anonymous.request("/api/v1/entries", {
      method: "POST",
      headers: json,
      body: "{not json",
    });
    expect(malformed.status).toBe(401);
    expect(malformed.body.error.code).toBe("unauthenticated");

    const oversized = await off.anonymous.request("/api/v1/entries", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ body: "x".repeat(70 * 1024) }),
    });
    expect(oversized.status).toBe(401);
    expect(oversized.body.error.code).toBe("unauthenticated");
  });

  it("answers malformed JSON from an actor with 400 invalid_json", async () => {
    const res = await off.as(alice).request("/api/v1/entries", {
      method: "POST",
      headers: json,
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_json");
  });

  it("answers a 70 KB body from an actor with 413 too_large", async () => {
    const res = await off.as(alice).request("/api/v1/entries", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ body: "x".repeat(70 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("too_large");
    expect(res.body.error.field).toBeUndefined();
  });

  it("keeps /healthz open without an actor", async () => {
    const res = await off.anonymous.get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("requireHuman", () => {
  let server: Server;
  let url: string;
  let reached: Actor[] = [];

  beforeAll(async () => {
    const byToken: Record<string, Actor> = { human: alice, agent: builder };
    const app = express();
    app.use(
      actorMiddleware({
        resolveActor: (req) =>
          byToken[(req.get("authorization") ?? "").replace("Bearer ", "")],
        devActorHeader: false,
      }),
    );
    app.post("/only-people", requireHuman, (req, res) => {
      reached.push(actorOf(req));
      res.json({ ok: true });
    });
    app.use(errorHandler);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const call = (token: string) =>
    fetch(`${url}/only-people`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });

  it("passes a human to the route", async () => {
    reached = [];
    const res = await call("human");
    expect(res.status).toBe(200);
    expect(reached).toEqual([alice]);
  });

  it("refuses an agent on a humans-only route", async () => {
    reached = [];
    const res = await call("agent");
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.code).toBe("humans_only");
    expect(reached).toEqual([]);
  });
});

describe("actor keys", () => {
  it("gives the rate limiter key of each actor", () => {
    expect(actorKey(alice)).toBe("human:alice");
    expect(actorKey(builder)).toBe("agent:claude-code/builder:alice");
  });

  it("gives the audit actor of each actor", () => {
    expect(auditActor(alice)).toEqual({ actor: "human:alice", details: {} });
    expect(auditActor(builder)).toEqual({
      actor: "agent:claude-code/builder",
      details: { on_behalf_of: "alice" },
    });
  });

  it("names the person whose membership counts", () => {
    expect(personOf(alice)).toBe("alice");
    expect(personOf(builder)).toBe("alice");
  });
});
