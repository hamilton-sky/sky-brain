// Story: An owner takes a workspace out, or deletes it.
import { beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  devices,
  entries,
  features,
  invites,
  members,
  projects,
  workspaces,
} from "../../../apps/server/src/db/schema.ts";
import {
  agent,
  auditRows,
  entry,
  expectError,
  human,
  seed,
  seedWorld,
  setup,
  snapshot,
  uid,
  type Db,
  type World,
} from "./helpers.ts";

const ctx = setup();

/** Every row of every workspace table that belongs to a workspace, plus all devices. */
async function rowsOf(db: Db, w: World) {
  const projectIds = (await db.select().from(projects))
    .filter((p: { workspaceId: string }) => p.workspaceId === w.workspaceId)
    .map((p: { id: string }) => p.id);
  const byWs = <T extends { workspaceId: string }>(rows: T[]) =>
    rows.filter((r) => r.workspaceId === w.workspaceId);
  return {
    workspaces: (await db.select().from(workspaces)).filter(
      (r: { id: string }) => r.id === w.workspaceId,
    ),
    members: byWs(await db.select().from(members)),
    invites: byWs(await db.select().from(invites)),
    projects: byWs(await db.select().from(projects)),
    features: (await db.select().from(features)).filter(
      (r: { projectId: string }) =>
        projectIds.includes(r.projectId) || r.projectId === w.projectId,
    ),
    entries: byWs(await db.select().from(entries)),
  };
}

async function populate(w: World): Promise<void> {
  const owner = ctx.server.as(human(w.owner));
  expect(
    (await owner.post("/api/v1/entries", entry(w.proj, "rule"))).status,
  ).toBe(201);
  expect(
    (
      await owner.post(
        "/api/v1/entries",
        entry(w.feat, "note", { source: "web" }),
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await ctx.server
        .as(agent(w.editor))
        .post("/api/v1/entries", entry(w.feat, "claim"))
    ).status,
  ).toBe(201);
  await ctx.db
    .insert(invites)
    .values({
      workspaceId: w.workspaceId,
      email: `${uid("inv")}@example.com`,
      role: "editor",
      invitedBy: w.owner,
    });
}

describe("export", () => {
  // "`GET /api/v1/workspaces/:id/export` gives the owner the export document (Interfaces ->
  // Routes) with every member, invite, project, feature, entry and audit row of the workspace."
  it("gives the owner every member, invite, project, feature, entry and audit row", async () => {
    const w = await seedWorld(ctx.db);
    const other = await seedWorld(ctx.db);
    await populate(w);
    await populate(other);
    const quarantined = await seed(ctx.db, w, "note", "quarantined", {
      quarantinedBecause: "tool-call",
    });

    const res = await ctx.server
      .as(human(w.owner))
      .get(`/api/v1/workspaces/${w.workspaceId}/export`);
    expect(res.status).toBe(200);
    const doc = res.body;
    expect(doc.format).toBe("sky-brain-export/1");
    expect(Number.isNaN(Date.parse(doc.exported_at))).toBe(false);
    expect(doc.workspace.id).toBe(w.workspaceId);
    expect(doc.workspace.name).toBe(w.name);

    expect(
      doc.members
        .map((m: { user_id: string; role: string }) => [m.user_id, m.role])
        .sort(),
    ).toEqual(
      [
        [w.owner, "owner"],
        [w.editor, "editor"],
        [w.viewer, "viewer"],
      ].sort(),
    );
    expect(doc.invites.length).toBe(1);
    expect(doc.invites[0].workspace_id).toBe(w.workspaceId);
    expect(doc.projects.map((p: { id: string }) => p.id)).toEqual([
      w.projectId,
    ]);
    expect(doc.features.map((f: { id: string }) => f.id)).toEqual([
      w.featureId,
    ]);

    const stored = await rowsOf(ctx.db, w);
    expect(doc.entries.map((e: { id: string }) => e.id).sort()).toEqual(
      stored.entries.map((e: { id: string }) => e.id).sort(),
    );
    const q = doc.entries.find((e: { id: string }) => e.id === quarantined.id);
    expect(q.status).toBe("quarantined");
    expect(q.quarantined_because).toBe("tool-call");
    for (const e of doc.entries as { workspace_id: string }[])
      expect(e.workspace_id).toBe(w.workspaceId);

    const audit = await auditRows(ctx.db, w.workspaceId);
    // The export's own workspace.export row may or may not be in this export; it is in the next.
    const exported = doc.audit_log.filter(
      (r: { action: string }) => r.action !== "workspace.export",
    );
    expect(exported.length).toBe(
      audit.filter((r: { action: string }) => r.action !== "workspace.export")
        .length,
    );
    expect(exported.length).toBeGreaterThanOrEqual(3);
    for (const r of doc.audit_log) {
      expect(Object.keys(r).sort()).toEqual([
        "action",
        "actor",
        "at",
        "details",
        "seq",
        "target_id",
        "workspace_id",
      ]);
      expect(r.workspace_id).toBe(w.workspaceId);
    }
    const seqs = doc.audit_log.map((r: { seq: number }) => Number(r.seq));
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(res.text).not.toContain(other.workspaceId);
  });

  // Interfaces -> Routes: "Export writes a `workspace.export` audit row (seen in the next export)."
  it("writes a workspace.export audit row, seen in the next export", async () => {
    const w = await seedWorld(ctx.db);
    const first = await ctx.server
      .as(human(w.owner))
      .get(`/api/v1/workspaces/${w.workspaceId}/export`);
    expect(first.status).toBe(200);
    const second = await ctx.server
      .as(human(w.owner))
      .get(`/api/v1/workspaces/${w.workspaceId}/export`);
    const rows = second.body.audit_log.filter(
      (r: { action: string }) => r.action === "workspace.export",
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({
      actor: `human:${w.owner}`,
      target_id: w.workspaceId,
      details: {},
    });
  });
});

describe("delete", () => {
  // "`DELETE /api/v1/workspaces/:id` with `confirm` equal to the workspace's name answers 204.
  // Afterwards no `workspaces`, `members`, `invites`, `projects`, `features` or `entries` row of it
  // remains, every other workspace's rows and every `devices` row are unchanged, and one
  // `audit_log` row exists with action `workspace.delete`, actor `human:<owner id>`, and the
  // deleted workspace's id as `workspace_id` and `target_id`."
  // Edge: "Delete workspace A | A's workspace, member, invite, project, feature and entry rows are
  // gone; one `workspace.delete` audit row for A remains; B is unchanged; `devices` untouched;
  // every earlier audit row of A remains, unchanged"
  it("deletes every row of the workspace, keeps B and devices, and writes one workspace.delete row", async () => {
    const w = await seedWorld(ctx.db);
    const other = await seedWorld(ctx.db);
    await populate(w);
    await populate(other);
    const old = await seed(ctx.db, w, "decision", "approved");
    expect(
      (
        await ctx.server
          .as(human(w.owner))
          .post(`/api/v1/entries/${old.id}/supersede`, {
            title: "N",
            body: "b",
          })
      ).status,
    ).toBe(201);
    const q = await seed(ctx.db, w, "question", "open");
    expect(
      (
        await ctx.server
          .as(human(w.owner))
          .post(`/api/v1/entries/${q.id}/answer`, { body: "b" })
      ).status,
    ).toBe(201);
    await ctx.db
      .insert(devices)
      .values({ userId: w.owner, name: uid("laptop") });

    const devicesBefore = await ctx.db.select().from(devices);
    const otherBefore = {
      rows: await rowsOf(ctx.db, other),
      ...(await snapshot(ctx.db, other.workspaceId)),
    };
    const auditBefore = await auditRows(ctx.db, w.workspaceId);
    expect((await rowsOf(ctx.db, w)).entries.length).toBeGreaterThan(0);

    const res = await ctx.server
      .as(human(w.owner))
      .delete(`/api/v1/workspaces/${w.workspaceId}`, { confirm: w.name });
    expect(res.status).toBe(204);

    expect(await rowsOf(ctx.db, w)).toEqual({
      workspaces: [],
      members: [],
      invites: [],
      projects: [],
      features: [],
      entries: [],
    });
    expect({
      rows: await rowsOf(ctx.db, other),
      ...(await snapshot(ctx.db, other.workspaceId)),
    }).toEqual(otherBefore);
    expect(await ctx.db.select().from(devices)).toEqual(devicesBefore);

    const auditAfter = await auditRows(ctx.db, w.workspaceId);
    // "Every `audit_log` row the deleted workspace had before the delete is still there, unchanged"
    expect(auditAfter.slice(0, auditBefore.length)).toEqual(auditBefore);
    const deletes = auditAfter.filter(
      (r: { action: string }) => r.action === "workspace.delete",
    );
    expect(deletes.length).toBe(1);
    expect(deletes[0]).toMatchObject({
      action: "workspace.delete",
      actor: `human:${w.owner}`,
      workspaceId: w.workspaceId,
      targetId: w.workspaceId,
      details: {},
    });
    expect(auditAfter.length).toBe(auditBefore.length + 1);
  });

  // "Every `audit_log` row the deleted workspace had before the delete is still there,
  // unchanged: the audit log stays strictly append-only"
  it("keeps every earlier audit row of the deleted workspace", async () => {
    const w = await seedWorld(ctx.db);
    await populate(w);
    const before = (await ctx.db.select().from(auditLog)).filter(
      (r: { workspaceId: string }) => r.workspaceId === w.workspaceId,
    );
    expect(before.length).toBeGreaterThanOrEqual(3);
    expect(
      (
        await ctx.server
          .as(human(w.owner))
          .delete(`/api/v1/workspaces/${w.workspaceId}`, { confirm: w.name })
      ).status,
    ).toBe(204);
    const after = (await ctx.db.select().from(auditLog)).filter(
      (r: { workspaceId: string }) => r.workspaceId === w.workspaceId,
    );
    for (const row of before) expect(after).toContainEqual(row);
  });

  // "A `DELETE` with no `confirm` (no JSON body, or `confirm` missing or not a string) answers 400
  // `invalid_request`; a `confirm` that is a string but not exactly the workspace's name answers
  // 400 `confirm_mismatch`. Neither deletes anything or writes an audit row."
  // Edges: "Delete with no `confirm` (no body, missing, or not a string) | 400 `invalid_request`,
  // nothing deleted"; "Delete with a `confirm` that is not exactly the workspace's name | 400
  // `confirm_mismatch`, nothing deleted"
  it("answers 400 invalid_request with no confirm, and deletes nothing", async () => {
    const w = await seedWorld(ctx.db);
    await populate(w);
    const before = {
      rows: await rowsOf(ctx.db, w),
      ...(await snapshot(ctx.db, w.workspaceId)),
    };
    const c = ctx.server.as(human(w.owner));
    expectError(
      await c.delete(`/api/v1/workspaces/${w.workspaceId}`),
      400,
      "invalid_request",
    );
    expectError(
      await c.delete(`/api/v1/workspaces/${w.workspaceId}`, {}),
      400,
      "invalid_request",
    );
    expectError(
      await c.delete(`/api/v1/workspaces/${w.workspaceId}`, { confirm: 12 }),
      400,
      "invalid_request",
    );
    expectError(
      await c.delete(`/api/v1/workspaces/${w.workspaceId}`, { confirm: null }),
      400,
      "invalid_request",
    );
    expect({
      rows: await rowsOf(ctx.db, w),
      ...(await snapshot(ctx.db, w.workspaceId)),
    }).toEqual(before);
  });

  it("answers 400 confirm_mismatch to a confirm that is not exactly the name, and deletes nothing", async () => {
    const w = await seedWorld(ctx.db);
    await populate(w);
    const before = {
      rows: await rowsOf(ctx.db, w),
      ...(await snapshot(ctx.db, w.workspaceId)),
    };
    const c = ctx.server.as(human(w.owner));
    for (const confirm of [
      "",
      "wrong",
      w.name.toUpperCase(),
      ` ${w.name}`,
      `${w.name} `,
      w.workspaceId,
    ]) {
      expectError(
        await c.delete(`/api/v1/workspaces/${w.workspaceId}`, { confirm }),
        400,
        "confirm_mismatch",
      );
    }
    expect({
      rows: await rowsOf(ctx.db, w),
      ...(await snapshot(ctx.db, w.workspaceId)),
    }).toEqual(before);
  });

  // Edge: "A viewer calls delete with the wrong `confirm` | 403 `owner_only` (role comes before state)"
  it("answers a viewer with a wrong confirm 403 owner_only", async () => {
    const w = await seedWorld(ctx.db);
    expectError(
      await ctx.server
        .as(human(w.viewer))
        .delete(`/api/v1/workspaces/${w.workspaceId}`, { confirm: "wrong" }),
      403,
      "owner_only",
    );
    expectError(
      await ctx.server
        .as(human(w.editor))
        .delete(`/api/v1/workspaces/${w.workspaceId}`, { confirm: "wrong" }),
      403,
      "owner_only",
    );
  });

  // Edge: "A viewer calls delete with no `confirm` | 400 `invalid_request` (request shape comes before role)"
  it("answers a viewer with no confirm 400 invalid_request", async () => {
    const w = await seedWorld(ctx.db);
    expectError(
      await ctx.server
        .as(human(w.viewer))
        .delete(`/api/v1/workspaces/${w.workspaceId}`),
      400,
      "invalid_request",
    );
    expectError(
      await ctx.server
        .as(human(w.viewer))
        .delete(`/api/v1/workspaces/${w.workspaceId}`, { confirm: 1 }),
      400,
      "invalid_request",
    );
  });

  // Edge: "A viewer or an editor calls export or delete | 403 `owner_only` (not `role_cannot_write`)"
  it("answers an editor or viewer 403 owner_only from export and delete, and deletes nothing", async () => {
    const w = await seedWorld(ctx.db);
    await populate(w);
    const before = {
      rows: await rowsOf(ctx.db, w),
      ...(await snapshot(ctx.db, w.workspaceId)),
    };
    for (const person of [w.editor, w.viewer]) {
      const c = ctx.server.as(human(person));
      expectError(
        await c.get(`/api/v1/workspaces/${w.workspaceId}/export`),
        403,
        "owner_only",
      );
      expectError(
        await c.delete(`/api/v1/workspaces/${w.workspaceId}`, {
          confirm: w.name,
        }),
        403,
        "owner_only",
      );
    }
    expect({
      rows: await rowsOf(ctx.db, w),
      ...(await snapshot(ctx.db, w.workspaceId)),
    }).toEqual(before);
  });
});
