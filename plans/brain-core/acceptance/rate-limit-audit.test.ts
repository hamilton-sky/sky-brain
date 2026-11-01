// Story: Nothing poisoned or secret gets in: the rate limit and the audit log.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer } from "../../../apps/server/src/testing/harness.ts";
import { auditLog } from "../../../apps/server/src/db/schema.ts";
import {
  AGENT_ID,
  agent,
  auditRows,
  entry,
  expectError,
  human,
  seed,
  seedWorld,
  setup,
  type Server,
  type World,
} from "./helpers.ts";

const ctx = setup();
let strict: Server;
let refilling: Server;
let w: World;

beforeAll(async () => {
  w = await seedWorld(ctx.db);
  strict = await startTestServer({
    db: ctx.db,
    rateLimit: { capacity: 3, refillPerSecond: 0.01 },
  });
  refilling = await startTestServer({
    db: ctx.db,
    rateLimit: { capacity: 1, refillPerSecond: 4 },
  });
}, 60_000);

afterAll(async () => {
  if (strict) await strict.close();
  if (refilling) await refilling.close();
}, 60_000);

describe("rate limit", () => {
  // "A caller who makes more write calls than the rate limit allows gets 429 `rate_limited` with a
  // `Retry-After` header; another actor is not affected."
  // Edge: "Write burst over the limit | 429 `rate_limited`, `Retry-After`; other actors
  // unaffected; tokens refill over time"
  it("answers 429 rate_limited with Retry-After past the limit, and leaves another actor alone", async () => {
    const c = strict.as(human(w.owner));
    for (let i = 0; i < 3; i += 1) {
      expect(
        (await c.post("/api/v1/entries", entry(w.proj, "note"))).status,
      ).toBe(201);
    }
    const over = await c.post("/api/v1/entries", entry(w.proj, "note"));
    expectError(over, 429, "rate_limited");
    const retry = over.headers.get("retry-after");
    expect(retry).not.toBeNull();
    expect(Number(retry)).toBeGreaterThan(0);

    expect(
      (
        await strict
          .as(human(w.editor))
          .post("/api/v1/entries", entry(w.proj, "note"))
      ).status,
    ).toBe(201);
    // An agent acting for the same person is another actor.
    expect(
      (
        await strict
          .as(agent(w.owner))
          .post("/api/v1/entries", entry(w.proj, "note"))
      ).status,
    ).toBe(201);
  });

  it("counts ask, supersede, approve, reject, release and answer as writes", async () => {
    const c = strict.as(human(w.editor + "x"));
    // A user with no membership: every call is refused later (404), but each one counts.
    const id = "22222222-2222-4222-8222-222222222222";
    expect(
      (await c.post("/api/v1/ask", { scope: w.proj, title: "Q", body: "b" }))
        .status,
    ).not.toBe(429);
    expect((await c.post(`/api/v1/entries/${id}/approve`)).status).not.toBe(
      429,
    );
    expect((await c.post(`/api/v1/entries/${id}/reject`)).status).not.toBe(429);
    expectError(
      await c.post(`/api/v1/entries/${id}/release`),
      429,
      "rate_limited",
    );
    const d = strict.as(human(w.viewer + "y"));
    await d.post(`/api/v1/entries/${id}/supersede`, { title: "t", body: "b" });
    await d.post(`/api/v1/entries/${id}/answer`, { body: "b" });
    await d.post(`/api/v1/entries/${id}/answer`, { body: "b" });
    expectError(
      await d.post("/api/v1/entries", entry(w.proj, "note")),
      429,
      "rate_limited",
    );
  });

  // "Every call that reaches the rate limit step counts, whatever it answers later."
  it("counts calls that are refused after the rate limit step", async () => {
    const c = strict.as(human(w.viewer));
    // A viewer's writes fail at the role step (403) and a bad body at the shape step (400).
    expectError(
      await c.post("/api/v1/entries", entry(w.proj, "note")),
      403,
      "role_cannot_write",
    );
    expectError(
      await c.post("/api/v1/entries", { scope: w.proj, kind: "note" }),
      400,
      "invalid_request",
    );
    expectError(
      await c.post(
        "/api/v1/entries",
        entry({ project_id: "33333333-3333-4333-8333-333333333333" }, "note"),
      ),
      404,
      "not_found",
    );
    expectError(
      await c.post("/api/v1/entries", entry(w.proj, "note")),
      429,
      "rate_limited",
    );
  });

  it("does not count reads", async () => {
    const c = strict.as(human(w.owner + "r"));
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await c.get(`/api/v1/entries?project_id=${w.projectId}`)).status,
      ).not.toBe(429);
    }
  });

  it("refills tokens over time", async () => {
    const c = refilling.as(human(w.owner));
    expect(
      (await c.post("/api/v1/entries", entry(w.proj, "note"))).status,
    ).toBe(201);
    expectError(
      await c.post("/api/v1/entries", entry(w.proj, "note")),
      429,
      "rate_limited",
    );
    await new Promise((r) => setTimeout(r, 600));
    expect(
      (await c.post("/api/v1/entries", entry(w.proj, "note"))).status,
    ).toBe(201);
  });
});

describe("audit log", () => {
  // "Every write and every status change adds an `audit_log` row whose actor is the caller
  // (Interfaces -> Audit log); a refused request adds none."
  it("a human's post adds one entry.create row with the human actor", async () => {
    const before = await auditRows(ctx.db, w.workspaceId);
    const title = "Audit title secretword";
    const res = await ctx.server
      .as(human(w.owner))
      .post(
        "/api/v1/entries",
        entry(w.proj, "decision", { title, body: "bodyword" }),
      );
    expect(res.status).toBe(201);
    const added = (await auditRows(ctx.db, w.workspaceId)).slice(before.length);
    expect(added.length).toBe(1);
    expect(added[0]).toMatchObject({
      workspaceId: w.workspaceId,
      actor: `human:${w.owner}`,
      action: "entry.create",
      targetId: res.body.entry.id,
      details: { kind: "decision", status: "approved" },
    });
    const details = JSON.stringify(added[0].details);
    expect(details).not.toContain("secretword");
    expect(details).not.toContain("bodyword");
  });

  it("an agent's post adds one entry.create row with the agent actor and on_behalf_of", async () => {
    const before = await auditRows(ctx.db, w.workspaceId);
    const res = await ctx.server
      .as(agent(w.editor))
      .post("/api/v1/entries", entry(w.feat, "claim"));
    expect(res.status).toBe(201);
    const added = (await auditRows(ctx.db, w.workspaceId)).slice(before.length);
    expect(added.length).toBe(1);
    expect(added[0]).toMatchObject({
      actor: `agent:${AGENT_ID}`,
      action: "entry.create",
      targetId: res.body.entry.id,
      details: { kind: "claim", status: "proposed", on_behalf_of: w.editor },
    });
  });

  it("a status change adds an entry.status row with from and to", async () => {
    const p = await seed(ctx.db, w, "decision", "proposed", {
      authorKind: "agent",
      author: AGENT_ID,
    });
    const before = await auditRows(ctx.db, w.workspaceId);
    expect(
      (
        await ctx.server
          .as(human(w.editor))
          .post(`/api/v1/entries/${p.id}/approve`)
      ).status,
    ).toBe(200);
    const added = (await auditRows(ctx.db, w.workspaceId)).slice(before.length);
    expect(added.length).toBe(1);
    expect(added[0]).toMatchObject({
      actor: `human:${w.editor}`,
      action: "entry.status",
      targetId: p.id,
      details: { from: "proposed", to: "approved" },
    });
    expect(added[0].details).toHaveProperty("via");
  });

  it("a human's supersede records the new entry and the old one's status change", async () => {
    const old = await seed(ctx.db, w, "decision", "approved");
    const before = await auditRows(ctx.db, w.workspaceId);
    const res = await ctx.server
      .as(human(w.owner))
      .post(`/api/v1/entries/${old.id}/supersede`, { title: "New", body: "b" });
    expect(res.status).toBe(201);
    const added = (await auditRows(ctx.db, w.workspaceId)).slice(before.length);
    expect(
      added
        .map((r: { action: string; targetId: string }) => [
          r.action,
          r.targetId,
        ])
        .sort(),
    ).toEqual(
      [
        ["entry.create", res.body.entry.id],
        ["entry.status", old.id],
      ].sort(),
    );
  });

  it("a refused request adds no audit row", async () => {
    const p = await seed(ctx.db, w, "decision", "approved");
    const before = await auditRows(ctx.db, w.workspaceId);
    expectError(
      await ctx.server
        .as(agent(w.owner))
        .post("/api/v1/entries", entry(w.proj, "rule")),
      403,
      "agent_cannot_write_rule",
    );
    expectError(
      await ctx.server
        .as(human(w.viewer))
        .post("/api/v1/entries", entry(w.proj, "note")),
      403,
      "role_cannot_write",
    );
    expectError(
      await ctx.server
        .as(human(w.owner))
        .post(
          "/api/v1/entries",
          entry(w.proj, "note", { title: "t".repeat(201) }),
        ),
      413,
      "too_large",
    );
    expectError(
      await ctx.server
        .as(human(w.owner))
        .post(`/api/v1/entries/${p.id}/approve`),
      409,
      "invalid_state",
    );
    expect(await auditRows(ctx.db, w.workspaceId)).toEqual(before);
  });

  // Edge: "A direct `UPDATE`, `DELETE` or `TRUNCATE` on `audit_log` | the database raises; the row stays"
  it("the database refuses UPDATE, DELETE and TRUNCATE on audit_log", async () => {
    expect(
      (
        await ctx.server
          .as(human(w.owner))
          .post("/api/v1/entries", entry(w.proj, "note"))
      ).status,
    ).toBe(201);
    const before = await auditRows(ctx.db, w.workspaceId);
    expect(before.length).toBeGreaterThan(0);
    await expect(
      ctx.db.update(auditLog).set({ action: "tampered" }),
    ).rejects.toThrow();
    await expect(ctx.db.delete(auditLog)).rejects.toThrow();
    await expect(ctx.db.execute("TRUNCATE TABLE audit_log")).rejects.toThrow();
    expect(await auditRows(ctx.db, w.workspaceId)).toEqual(before);
  });
});
