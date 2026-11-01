// Check order step 6 for a scope: derive the chain from the one id given and check membership
// in the same query. Unknown and not-a-member both answer 404, so existence is not revealed.
import type { Actor } from "@sky-brain/shared/actor";
import type { Role } from "@sky-brain/shared/enums";
import type { ScopeRef } from "@sky-brain/shared/scope";
import { and, eq } from "drizzle-orm";
import { personOf } from "../actor/keys.ts";
import type { DbOrTx } from "../db/client.ts";
import { features, members, projects, workspaces } from "../db/schema.ts";
import { HttpError } from "../http/http-error.ts";

export interface ResolvedScope {
  workspaceId: string;
  projectId: string | null;
  featureId: string | null;
  level: "workspace" | "project" | "feature";
  role: Role;
}

export async function resolveScope(
  db: DbOrTx,
  actor: Actor,
  ref: ScopeRef,
): Promise<ResolvedScope> {
  const person = personOf(actor);
  let found: ResolvedScope | undefined;
  if ("workspace_id" in ref) {
    const [row] = await db
      .select({ workspaceId: workspaces.id, role: members.role })
      .from(workspaces)
      .innerJoin(
        members,
        and(eq(members.workspaceId, workspaces.id), eq(members.userId, person)),
      )
      .where(eq(workspaces.id, ref.workspace_id));
    if (row) {
      found = { ...row, projectId: null, featureId: null, level: "workspace" };
    }
  } else if ("project_id" in ref) {
    const [row] = await db
      .select({
        workspaceId: projects.workspaceId,
        projectId: projects.id,
        role: members.role,
      })
      .from(projects)
      .innerJoin(
        members,
        and(
          eq(members.workspaceId, projects.workspaceId),
          eq(members.userId, person),
        ),
      )
      .where(eq(projects.id, ref.project_id));
    if (row) found = { ...row, featureId: null, level: "project" };
  } else {
    const [row] = await db
      .select({
        workspaceId: projects.workspaceId,
        projectId: projects.id,
        featureId: features.id,
        role: members.role,
      })
      .from(features)
      .innerJoin(projects, eq(projects.id, features.projectId))
      .innerJoin(
        members,
        and(
          eq(members.workspaceId, projects.workspaceId),
          eq(members.userId, person),
        ),
      )
      .where(eq(features.id, ref.feature_id));
    if (row) found = { ...row, level: "feature" };
  }
  if (!found) throw new HttpError(404, "not_found", "No such scope.");
  return found;
}
