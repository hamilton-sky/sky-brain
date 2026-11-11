// Renew, release, done and fail filtered by workspace membership and a run token's project
// (bar 4), the role, and the claim and report verbs (cloud-task-board ticket 07).
import type { Verb } from "@sky-brain/shared/run-tokens";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { taskEvents, tasks } from "../db/schema.ts";
import {
  device,
  expectError,
  human,
  useRunTokenFixture,
  world,
} from "../run-tokens/tests/fixture.ts";
import type { TestClient } from "../testing/harness.ts";
import {
  mintRunToken,
  seedGoal,
  seedTask,
  withToken,
} from "../testing/task-seeds.ts";

const ctx = useRunTokenFixture();

async function runToken(
  person: string,
  projectId: string,
  verbs: Verb[] = ["read", "claim", "report"],
) {
  const d = await device(ctx.server, person);
  const { runToken } = await mintRunToken(ctx.server, d.deviceToken, {
    project_id: projectId,
    verbs,
  });
  return withToken(ctx.server, runToken);
}

const reports = (seq: number): [string, object][] => [
  ["renew", { claim_seq: seq }],
  ["release", { claim_seq: seq }],
  ["done", { claim_seq: seq, proof: { summary: "ok" } }],
  ["fail", { claim_seq: seq, reason: "broke" }],
];

/** A task in `projectId` approved by `person`, claimed by `holder`. */
async function heldTask(
  w: { workspaceId: string },
  projectId: string,
  person: string,
  holder: TestClient,
) {
  const g = await seedGoal(ctx.db, {
    workspaceId: w.workspaceId,
    projectId,
    status: "approved",
    approvedBy: person,
  });
  const { id } = await seedTask(ctx.db, { goalId: g.id });
  const res = await holder.post(`/api/v1/tasks/${id}/claim`, {});
  expect(res.status).toBe(200);
  return { id, seq: res.body.lease.claim_seq as number };
}

async function expectStillHeld(id: string) {
  const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, id));
  expect(row).toMatchObject({
    status: "in_progress",
    claimSeq: 1,
    attempts: 0,
    proof: null,
    failReason: null,
  });
  const evs = await ctx.db
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, id))
    .orderBy(asc(taskEvents.seq));
  expect(evs.map((e) => e.kind)).toEqual(["claimed"]);
}

describe("workspace B (bar 4)", () => {
  it("B's owner, B's agent and a B run token get 404 on every report route for A's task", async () => {
    const a = await world(ctx.db);
    const b = await world(ctx.db);
    const holder = await runToken(a.editor, a.projectA);
    const { id, seq } = await heldTask(a, a.projectA, a.editor, holder);
    const callers = [
      ctx.server.as(human(b.owner)),
      ctx.server.as({
        kind: "agent",
        agent_id: "claude-code",
        on_behalf_of: b.owner,
      }),
      await runToken(b.owner, b.projectA),
    ];
    for (const c of callers) {
      for (const [verb, body] of reports(seq)) {
        expectError(
          await c.post(`/api/v1/tasks/${id}/${verb}`, body),
          404,
          "not_found",
        );
      }
    }
    await expectStillHeld(id);
  });

  it("a run token of another project of the same person gets 404", async () => {
    const w = await world(ctx.db);
    const holder = await runToken(w.editor, w.projectA);
    const { id, seq } = await heldTask(w, w.projectA, w.editor, holder);
    for (const project of [w.projectB, w.projectC]) {
      const c = await runToken(w.editor, project);
      for (const [verb, body] of reports(seq)) {
        expectError(
          await c.post(`/api/v1/tasks/${id}/${verb}`, body),
          404,
          "not_found",
        );
      }
    }
    await expectStillHeld(id);
  });
});

describe("verbs and role", () => {
  it("a token without report gets 403 on done and fail; one without claim on renew and release", async () => {
    const w = await world(ctx.db);
    const holder = await runToken(w.editor, w.projectA);
    const { id, seq } = await heldTask(w, w.projectA, w.editor, holder);
    const noReport = await runToken(w.editor, w.projectA, ["read", "claim"]);
    const noClaim = await runToken(w.editor, w.projectA, ["read", "report"]);
    for (const [verb, body] of reports(seq)) {
      const c = verb === "done" || verb === "fail" ? noReport : noClaim;
      expectError(
        await c.post(`/api/v1/tasks/${id}/${verb}`, body),
        403,
        "verb_not_allowed",
      );
    }
    await expectStillHeld(id);
  });

  it("a viewer gets 403 role_cannot_write on every report route", async () => {
    const w = await world(ctx.db);
    const holder = await runToken(w.editor, w.projectA);
    const { id, seq } = await heldTask(w, w.projectA, w.editor, holder);
    const viewer = ctx.server.as(human(w.viewer));
    for (const [verb, body] of reports(seq)) {
      expectError(
        await viewer.post(`/api/v1/tasks/${id}/${verb}`, body),
        403,
        "role_cannot_write",
      );
    }
    await expectStillHeld(id);
  });
});
