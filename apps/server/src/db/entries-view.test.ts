import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeTestDb,
  createTestDb,
  seedEntry,
  seedWorkspace,
} from "../testing/harness.ts";
import type { Db } from "./client.ts";
import { notExpiredAt, toWireEntry } from "./entries-view.ts";
import { entries } from "./schema.ts";

let db: Db;
let workspaceId: string;
const now = new Date("2026-06-01T12:00:00.000Z");
const past = new Date("2026-06-01T11:00:00.000Z");
const future = new Date("2026-06-02T12:00:00.000Z");

beforeAll(async () => {
  db = await createTestDb();
  workspaceId = (await seedWorkspace(db, { name: "view" })).id;
}, 60_000);

afterAll(async () => {
  if (db) await closeTestDb(db);
}, 60_000);

async function row(id: string) {
  const [r] = await db.select().from(entries).where(eq(entries.id, id));
  return r!;
}

describe("toWireEntry", () => {
  it("maps a row to the snake_case wire Entry with ISO dates", async () => {
    const made = await seedEntry(db, {
      workspaceId,
      kind: "claim",
      status: "open",
      title: "Claim",
      body: "Body",
      authorKind: "agent",
      author: "claude-code/builder",
      onBehalfOf: "u1",
      source: "agent",
      expiresAt: future,
      allowAgentAnswers: true,
    });
    const wire = toWireEntry(await row(made.id), now);
    expect(wire).toEqual({
      id: made.id,
      seq: made.seq,
      workspace_id: workspaceId,
      project_id: null,
      feature_id: null,
      kind: "claim",
      status: "open",
      title: "Claim",
      body: "Body",
      author_kind: "agent",
      author: "claude-code/builder",
      on_behalf_of: "u1",
      source: "agent",
      refs: [],
      reply_to: null,
      supersedes: null,
      confidence: null,
      expires_at: future.toISOString(),
      allow_agent_answers: true,
      quarantined_because: null,
      created_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
      updated_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
    });
    expect(Object.keys(wire)).not.toContain("search");
  });

  it("reports expired for a proposed or open entry at or past expires_at", async () => {
    for (const status of ["proposed", "open"] as const) {
      const made = await seedEntry(db, {
        workspaceId,
        kind: "claim",
        status,
        title: "t",
        body: "b",
        expiresAt: past,
      });
      const r = await row(made.id);
      expect(toWireEntry(r, now).status).toBe("expired");
      expect(toWireEntry(r, past).status).toBe("expired");
      expect(toWireEntry(r, new Date(past.getTime() - 1)).status).toBe(status);
    }
    const approved = await seedEntry(db, {
      workspaceId,
      kind: "decision",
      status: "approved",
      title: "t",
      body: "b",
      expiresAt: past,
    });
    expect(toWireEntry(await row(approved.id), now).status).toBe("approved");
  });

  it("shows quarantined_because only while quarantined", async () => {
    const made = await seedEntry(db, {
      workspaceId,
      kind: "note",
      status: "quarantined",
      title: "t",
      body: "b",
      quarantinedBecause: "role-tag",
    });
    expect(toWireEntry(await row(made.id), now)).toMatchObject({
      status: "quarantined",
      quarantined_because: "role-tag",
    });
    await db
      .update(entries)
      .set({ status: "approved" })
      .where(eq(entries.id, made.id));
    const released = await row(made.id);
    expect(released.quarantinedBecause).toBe("role-tag");
    expect(toWireEntry(released, now)).toMatchObject({
      status: "approved",
      quarantined_because: null,
    });
  });
});

describe("notExpiredAt", () => {
  it("matches exactly the rows whose effective status is not expired", async () => {
    const ws = (await seedWorkspace(db, { name: "expiry-sql" })).id;
    const cases = [
      { status: "open", expiresAt: past },
      { status: "open", expiresAt: future },
      { status: "proposed", expiresAt: now },
      { status: "proposed" },
      { status: "approved", expiresAt: past },
    ] as const;
    const ids: string[] = [];
    for (const c of cases) {
      ids.push(
        (
          await seedEntry(db, {
            workspaceId: ws,
            kind: "claim",
            title: "t",
            body: "b",
            ...c,
          })
        ).id,
      );
    }
    const all = await db
      .select()
      .from(entries)
      .where(eq(entries.workspaceId, ws));
    const expected = all
      .filter((r) => toWireEntry(r, now).status !== "expired")
      .map((r) => r.id)
      .sort();
    const got = (
      await db
        .select({ id: entries.id })
        .from(entries)
        .where(and(eq(entries.workspaceId, ws), notExpiredAt(now)))
    )
      .map((r) => r.id)
      .sort();
    expect(got).toEqual(expected);
    expect(got).toEqual([ids[1], ids[3], ids[4]].sort());
  });
});
