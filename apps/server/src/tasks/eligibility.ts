// The one condition that says a task may be taken now (cloud-task-board spec.md Stories "A worker
// pulls, claims and reports", Design). Ready lists by it and claim updates by it, so the two can
// never disagree. Every time comparison uses the app clock, passed in, never SQL `now()`.
import {
  and,
  eq,
  isNull,
  lte,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import type { Request } from "express";
import { runContextOf } from "../actor/run-context.ts";
import { goals, members, taskDeps, tasks } from "../db/schema.ts";

export interface Eligibility {
  /** The human, or the person the agent acts for. */
  person: string;
  /** The app clock. */
  now: Date;
  /** A run token's workspace and project; absent for a caller without one. */
  runScope?: { workspaceId: string; projectId: string };
}

const jsonStrings = (column: SQLWrapper) =>
  sql`'[' || coalesce((select string_agg(to_json(u.v)::text, ',' order by u.n) from unnest(${column}) with ordinality as u(v, n)), '') || ']'`;

/**
 * `taskTextHash()` (task-text.ts) of the row's current text, computed in SQL: SHA-256 hex over
 * the JSON `[title, body, files, context_refs]` with no spaces, as `JSON.stringify` writes it.
 * `to_json(text)` escapes a string exactly as `JSON.stringify` does (quote, backslash, and
 * control characters below U+0020 as `\b \f \n \r \t` or lowercase `\u00xx`).
 */
const textHashSql = sql`encode(sha256(convert_to('[' || to_json(${tasks.title})::text || ',' || to_json(${tasks.body})::text || ',' || (case when ${tasks.files} is null then 'null' else ${jsonStrings(tasks.files)} end) || ',' || ${jsonStrings(tasks.contextRefs)} || ']', 'UTF8')), 'hex')`;

/** A condition on `tasks`, for a `WHERE` of a select or an update of that table. */
export function eligibleTask({ person, now, runScope }: Eligibility): SQL {
  return and(
    // The caller's person is a member of the task's workspace.
    sql`exists (select 1 from ${members} where ${members.workspaceId} = ${tasks.workspaceId} and ${members.userId} = ${person})`,
    ...(runScope
      ? [
          eq(tasks.workspaceId, runScope.workspaceId),
          eq(tasks.projectId, runScope.projectId),
        ]
      : []),
    // An approved goal, not held, that this person approved or is assigned.
    sql`exists (select 1 from ${goals} where ${goals.id} = ${tasks.goalId} and ${goals.status} = 'approved' and ${goals.quarantinedBecause} is null and (${goals.approvedBy} = ${person} or ${goals.assignee} = ${person}))`,
    isNull(tasks.quarantinedBecause),
    // Pinned: the text is what was approved. The row's text is hashed again here as well, so a
    // change that bypassed `text_hash` (a direct database edit) unpins it too.
    sql`${tasks.approvedHash} = ${tasks.textHash}`,
    sql`${tasks.approvedHash} = ${textHashSql}`,
    // Every dependency is done.
    sql`not exists (select 1 from ${taskDeps} join "tasks" as "dep" on "dep"."id" = ${taskDeps.dependsOnId} where ${taskDeps.taskId} = ${tasks.id} and "dep"."status" <> 'done')`,
    // Pending, or in progress with a lease that has run out.
    or(
      eq(tasks.status, "pending"),
      and(eq(tasks.status, "in_progress"), lte(tasks.leaseExpiresAt, now)),
    ),
  )!;
}

/** What `eligibleTask` needs from a request's run token; undefined without one. */
export function runScopeOf(req: Request): Eligibility["runScope"] | undefined {
  const run = runContextOf(req);
  if (run?.kind !== "run" || !run.workspaceId || !run.projectId)
    return undefined;
  return { workspaceId: run.workspaceId, projectId: run.projectId };
}
