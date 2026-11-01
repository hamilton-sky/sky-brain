// resolveScope and memberRole: the membership check every route uses (CLAUDE.md hard rule 4).
import type { Actor } from "@sky-brain/shared/actor";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeTestDb,
  createTestDb,
  seedFeature,
  seedProject,
  seedWorkspace,
  type Db,
} from "../testing/harness.ts";
import { memberRole } from "./member-role.ts";
import { resolveScope } from "./resolve-scope.ts";

const owner: Actor = { kind: "human", user_id: "owner-1" };
const viewer: Actor = { kind: "human", user_id: "viewer-1" };
const outsider: Actor = { kind: "human", user_id: "outsider-1" };
const agentForOwner: Actor = {
  kind: "agent",
  agent_id: "claude-code/builder",
  on_behalf_of: "owner-1",
};
const agentForOutsider: Actor = {
  kind: "agent",
  agent_id: "claude-code/builder",
  on_behalf_of: "outsider-1",
};
const missing = "00000000-0000-4000-8000-000000000000";

let db: Db;
let workspaceId: string;
let projectId: string;
let featureId: string;
let otherWorkspaceId: string;
let otherProjectId: string;
let otherFeatureId: string;

beforeAll(async () => {
  db = await createTestDb();
  workspaceId = (
    await seedWorkspace(db, {
      name: "A",
      members: [
        { userId: "owner-1", role: "owner" },
        { userId: "viewer-1", role: "viewer" },
      ],
    })
  ).id;
  projectId = (await seedProject(db, { workspaceId, slug: "p", name: "P" })).id;
  featureId = (await seedFeature(db, { projectId, slug: "f", name: "F" })).id;
  otherWorkspaceId = (
    await seedWorkspace(db, {
      name: "B",
      members: [{ userId: "outsider-1", role: "owner" }],
    })
  ).id;
  otherProjectId = (
    await seedProject(db, {
      workspaceId: otherWorkspaceId,
      slug: "p",
      name: "P",
    })
  ).id;
  otherFeatureId = (
    await seedFeature(db, { projectId: otherProjectId, slug: "f", name: "F" })
  ).id;
}, 60_000);

afterAll(async () => {
  if (db) await closeTestDb(db);
}, 60_000);

async function notFound(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    status: 404,
    code: "not_found",
  });
}

describe("resolveScope", () => {
  it("resolves a member's workspace scope", async () => {
    expect(
      await resolveScope(db, owner, { workspace_id: workspaceId }),
    ).toEqual({
      workspaceId,
      projectId: null,
      featureId: null,
      level: "workspace",
      role: "owner",
    });
  });

  it("resolves a member's project scope", async () => {
    expect(await resolveScope(db, owner, { project_id: projectId })).toEqual({
      workspaceId,
      projectId,
      featureId: null,
      level: "project",
      role: "owner",
    });
  });

  it("resolves a member's feature scope", async () => {
    expect(await resolveScope(db, owner, { feature_id: featureId })).toEqual({
      workspaceId,
      projectId,
      featureId,
      level: "feature",
      role: "owner",
    });
  });

  it("returns a viewer's role", async () => {
    const scope = await resolveScope(db, viewer, { project_id: projectId });
    expect(scope.role).toBe("viewer");
  });

  it("resolves the scope of an agent acting for a member", async () => {
    const scope = await resolveScope(db, agentForOwner, {
      feature_id: featureId,
    });
    expect(scope).toMatchObject({
      workspaceId,
      level: "feature",
      role: "owner",
    });
  });

  it("hides a workspace the caller is not a member of", async () => {
    await notFound(resolveScope(db, outsider, { workspace_id: workspaceId }));
    await notFound(resolveScope(db, outsider, { project_id: projectId }));
    await notFound(resolveScope(db, outsider, { feature_id: featureId }));
    await notFound(
      resolveScope(db, agentForOutsider, { project_id: projectId }),
    );
    await notFound(resolveScope(db, owner, { feature_id: otherFeatureId }));
    // The outsider still reaches its own workspace.
    const own = await resolveScope(db, outsider, {
      project_id: otherProjectId,
    });
    expect(own.workspaceId).toBe(otherWorkspaceId);
  });

  it("answers 404 for an id that does not exist", async () => {
    await notFound(resolveScope(db, owner, { workspace_id: missing }));
    await notFound(resolveScope(db, owner, { project_id: missing }));
    await notFound(resolveScope(db, owner, { feature_id: missing }));
  });
});

describe("memberRole", () => {
  it("gives the role of a member, or of the person an agent acts for", async () => {
    expect(await memberRole(db, workspaceId, owner)).toBe("owner");
    expect(await memberRole(db, workspaceId, viewer)).toBe("viewer");
    expect(await memberRole(db, workspaceId, agentForOwner)).toBe("owner");
  });

  it("gives undefined to a non-member", async () => {
    expect(await memberRole(db, workspaceId, outsider)).toBeUndefined();
    expect(await memberRole(db, workspaceId, agentForOutsider)).toBeUndefined();
    expect(await memberRole(db, missing, owner)).toBeUndefined();
  });
});
