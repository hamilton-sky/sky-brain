// Comments on an entry: people who may write add, resolve, reopen and delete them; anyone who
// may read the entry reads them (agents with `get`, on entries they may read); agents never
// write them (CLAUDE.md hard rule 3); every route is filtered by membership (hard rule 4).
import { COMMENTS_PER_ENTRY_MAX } from "@sky-brain/shared/comments";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, entryComments } from "@sky-brain/db/schema";
import {
  actorClients,
  expectError,
  useRunTokenFixture,
  world,
} from "../run-tokens/tests/fixture.ts";
import { seedEntry } from "../testing/harness.ts";

const ctx = useRunTokenFixture();

const { agent, person, runToken } = actorClients(ctx);

async function setup(trust: "proposed" | "quarantined" = "proposed") {
  const w = await world(ctx.db);
  const doc = await seedEntry(ctx.db, {
    workspaceId: w.workspaceId,
    title: "Consolidator plan",
    body: "# Plan\n\nMerge the Inbox nightly.",
    summary: "Merge the Inbox into Notebooks every night.",
    trust,
    authorKind: "agent",
  });
  return { w, entryId: doc.id, base: `/api/v1/entries/${doc.id}/comments` };
}

describe("entry comments", () => {
  it("a person comments on a passage; the entry and its comment list show it", async () => {
    const { w, entryId, base } = await setup();
    const res = await person(w.owner).post(base, {
      quote: "Merge the Inbox nightly.",
      body: "Weekly is enough.",
      color: "blue",
    });
    expect(res.status).toBe(201);
    expect(res.body.comment).toMatchObject({
      entry_id: entryId,
      quote: "Merge the Inbox nightly.",
      body: "Weekly is enough.",
      color: "blue",
      resolved: false,
      author_kind: "human",
      author: w.owner,
    });
    const general = await person(w.editor).post(base, { body: "Looks good" });
    expect(general.body.comment).toMatchObject({
      quote: null,
      color: "yellow",
    });

    const list = await person(w.viewer).get(base);
    expect(list.status).toBe(200);
    expect(list.body.comments).toHaveLength(2);
    const got = await person(w.owner).get(`/api/v1/entries/${entryId}`);
    // Both were written at the fixture's fixed clock, so compare as a set.
    expect(
      got.body.comments.map((c: { body: string }) => c.body).sort(),
    ).toEqual(["Looks good", "Weekly is enough."]);

    const audits = await ctx.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.targetId, entryId),
          eq(auditLog.action, "entry.comment.add"),
        ),
      );
    expect(audits).toHaveLength(2);
  });

  it("resolve, reopen and delete; an agent reads the comments but cannot write them", async () => {
    const { w, entryId, base } = await setup();
    const id = (await person(w.owner).post(base, { body: "Why nightly?" })).body
      .comment.id as string;

    const read = await agent(w.owner).get(`/api/v1/entries/${entryId}`);
    expect(read.body.comments.map((c: { id: string }) => c.id)).toEqual([id]);
    expectError(
      await agent(w.owner).post(base, { body: "Done" }),
      403,
      "humans_only",
    );
    expectError(
      await agent(w.owner).post(`${base}/${id}/resolve`, { resolved: true }),
      403,
      "humans_only",
    );
    expectError(
      await agent(w.owner).delete(`${base}/${id}`),
      403,
      "humans_only",
    );

    const done = await person(w.editor).post(`${base}/${id}/resolve`, {
      resolved: true,
    });
    expect(done.status).toBe(200);
    expect(done.body.comment).toMatchObject({
      resolved: true,
      resolved_by: w.editor,
    });
    const reopened = await person(w.owner).post(`${base}/${id}/resolve`, {
      resolved: false,
    });
    expect(reopened.body.comment).toMatchObject({
      resolved: false,
      resolved_by: null,
      resolved_at: null,
    });
    expect((await person(w.owner).delete(`${base}/${id}`)).status).toBe(204);
    expect(
      await ctx.db
        .select()
        .from(entryComments)
        .where(eq(entryComments.entryId, entryId)),
    ).toHaveLength(0);
    expectError(
      await person(w.owner).delete(`${base}/${id}`),
      404,
      "not_found",
    );
  });

  it("a viewer reads but cannot write; an outsider and another workspace get 404", async () => {
    const { w, base } = await setup();
    const id = (await person(w.owner).post(base, { body: "Note" })).body.comment
      .id as string;
    expectError(
      await person(w.viewer).post(base, { body: "Me too" }),
      403,
      "role_cannot_write",
    );
    expectError(
      await person(w.viewer).post(`${base}/${id}/resolve`, { resolved: true }),
      403,
      "role_cannot_write",
    );
    expectError(await person(w.outsider).get(base), 404, "not_found");
    expectError(
      await person(w.outsider).post(base, { body: "Hi" }),
      404,
      "not_found",
    );
    // The editor belongs to both workspaces; a comment id from one entry is not found on
    // another workspace's entry.
    const elsewhere = await seedEntry(ctx.db, {
      workspaceId: w.otherWorkspaceId,
      title: "Other",
      body: "x",
    });
    const otherBase = `/api/v1/entries/${elsewhere.id}/comments`;
    expect((await person(w.editor).get(otherBase)).body.comments).toEqual([]);
    expectError(
      await person(w.editor).post(`${otherBase}/${id}/resolve`, {
        resolved: true,
      }),
      404,
      "not_found",
    );
    expectError(
      await person(w.editor).delete(`${otherBase}/${id}`),
      404,
      "not_found",
    );
  });

  it("agents never see a held entry's comments", async () => {
    const { w, base } = await setup("quarantined");
    expect(
      (await person(w.owner).post(base, { body: "Check this" })).status,
    ).toBe(201);
    expectError(await agent(w.owner).get(base), 404, "not_found");
  });

  it("refuses secrets, oversize text, a bad color and more than the cap", async () => {
    const { w, entryId, base } = await setup();
    expectError(
      await person(w.owner).post(base, { body: "key AKIAIOSFODNN7EXAMPLE" }),
      422,
      "secret_detected",
    );
    expectError(
      await person(w.owner).post(base, { body: "x".repeat(2001) }),
      413,
      "too_large",
    );
    expect(
      (await person(w.owner).post(base, { body: "x", color: "red" })).status,
    ).toBe(400);
    await ctx.db.insert(entryComments).values(
      Array.from({ length: COMMENTS_PER_ENTRY_MAX }, () => ({
        entryId,
        workspaceId: w.workspaceId,
        body: "b",
        authorKind: "human" as const,
        author: w.owner,
        onBehalfOf: w.owner,
      })),
    );
    expectError(
      await person(w.owner).post(base, { body: "one more" }),
      409,
      "too_many_comments",
    );
  });

  it("run tokens have no verb for comments", async () => {
    const { w, base } = await setup();
    const c = await runToken(w.owner, w.projectA);
    expectError(await c.get(base), 403, "verb_not_allowed");
    expectError(await c.post(base, { body: "x" }), 403, "verb_not_allowed");
  });
});
