// What a run token is bound to, for the goal and task routes (tickets 04-07) to check:
// Check order step 7 (a run token's project differs: 404) and step 8 (its role caps the
// member's role).
import type { Role } from "@sky-brain/shared/enums";
import type { Request } from "express";
import { runContextOf } from "../actor/run-context.ts";
import { HttpError } from "../http/http-error.ts";

/**
 * 404 `not_found` when the request carries a run token bound to another workspace or project,
 * or a device token (which is bound to none). A request without either passes.
 */
export function assertRunScope(
  req: Request,
  target: { workspaceId: string; projectId: string },
): void {
  const context = runContextOf(req);
  if (!context) return;
  if (
    context.kind !== "run" ||
    context.workspaceId !== target.workspaceId ||
    context.projectId !== target.projectId
  ) {
    throw new HttpError(404, "not_found", "No such goal or task.");
  }
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

/** The lower of the run token's role and the member's role; the member's role without one. */
export function effectiveRole(req: Request, memberRole: Role): Role {
  const tokenRole = runContextOf(req)?.role;
  if (tokenRole === undefined) return memberRole;
  return RANK[tokenRole] < RANK[memberRole] ? tokenRole : memberRole;
}
