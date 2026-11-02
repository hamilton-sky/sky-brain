// Task board tables (cloud-task-board spec.md Interfaces, Events and audit), re-exported from
// schema.ts so drizzle.config.ts and client.ts see them. After a change, run
// `pnpm --filter @sky-brain/server exec drizzle-kit generate`.
//
// This module loads before schema.ts finishes (schema.ts re-exports it), so anything from
// schema.ts is used only inside callbacks. That is why `author_kind` is text with a check here,
// not schema.ts's `author_kind` enum (undefined at table-build time).
import type { AuthorKind } from "@sky-brain/shared/enums";
import {
  GOAL_EXECUTORS,
  GOAL_STATUSES,
  TASK_EVENT_KINDS,
  TASK_STATUSES,
  type Proof,
} from "@sky-brain/shared/tasks";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { features, projects, workspaces } from "./schema.ts";

export const goalExecutorEnum = pgEnum("goal_executor", GOAL_EXECUTORS);
export const goalStatusEnum = pgEnum("goal_status", GOAL_STATUSES);
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const taskEventKindEnum = pgEnum("task_event_kind", TASK_EVENT_KINDS);

const id = () => uuid("id").primaryKey().defaultRandom();
const at = (name: string) => timestamp(name, { withTimezone: true });

/** Who wrote the row, as for entries. */
const createdBy = () => ({
  authorKind: text("author_kind").$type<AuthorKind>().notNull(),
  author: text("author").notNull(),
  onBehalfOf: text("on_behalf_of").notNull(),
});

export const goals = pgTable(
  "goals",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    featureId: uuid("feature_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    executor: goalExecutorEnum("executor").notNull(),
    status: goalStatusEnum("status").notNull().default("draft"),
    /** A user id; null when nobody is assigned. */
    assignee: text("assignee"),
    approvedBy: text("approved_by"),
    approvedAt: at("approved_at"),
    /** The quarantine pattern that held the goal, written once when it is stored. */
    quarantinedBecause: text("quarantined_because"),
    ...createdBy(),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "goals_project_in_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "goals_feature_in_project_fk",
      columns: [t.featureId, t.projectId],
      foreignColumns: [features.id, features.projectId],
    }).onDelete("cascade"),
    check("goals_author_kind", sql`${t.authorKind} in ('human', 'agent')`),
    // The target of tasks_goal_in_project_fk.
    unique("goals_id_project_unique").on(t.id, t.projectId),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    goalId: uuid("goal_id").notNull(),
    /** Copied from the goal, for the filters and the advisory lock key. */
    workspaceId: uuid("workspace_id").notNull(),
    projectId: uuid("project_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    lane: text("lane"),
    /** Null means the task touches everything. */
    files: text("files").array(),
    contextRefs: text("context_refs")
      .array()
      .notNull()
      .default(sql`'{}'`),
    status: taskStatusEnum("status").notNull().default("pending"),
    /** Fails so far; claim and takeover leave it alone. */
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    holderActor: text("holder_actor"),
    holderPerson: text("holder_person"),
    holderDevice: uuid("holder_device"),
    leaseExpiresAt: at("lease_expires_at"),
    /** The fencing number: rises with every new lease. */
    claimSeq: bigint("claim_seq", { mode: "number" }).notNull().default(0),
    /** `taskTextHash()` of the current text. */
    textHash: text("text_hash").notNull(),
    /** `text_hash` at the goal's last approve; the task is pinned while the two match. */
    approvedHash: text("approved_hash"),
    quarantinedBecause: text("quarantined_because"),
    proof: jsonb("proof").$type<Proof>(),
    failReason: text("fail_reason"),
    position: integer("position").notNull(),
    ...createdBy(),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "tasks_goal_in_project_fk",
      columns: [t.goalId, t.projectId],
      foreignColumns: [goals.id, goals.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "tasks_project_in_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    check("tasks_max_attempts_range", sql`${t.maxAttempts} between 1 and 10`),
    check("tasks_author_kind", sql`${t.authorKind} in ('human', 'agent')`),
    index("tasks_project_status_idx").on(t.projectId, t.status),
    index("tasks_goal_position_idx").on(t.goalId, t.position),
  ],
);

export const taskDeps = pgTable(
  "task_deps",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnId: uuid("depends_on_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnId] }),
    check("task_deps_not_self", sql`${t.taskId} <> ${t.dependsOnId}`),
  ],
);

/**
 * Append-only: a trigger refuses UPDATE, DELETE and TRUNCATE. No foreign keys, like
 * `audit_log`, so the history outlives a deleted goal, task or workspace.
 */
export const taskEvents = pgTable(
  "task_events",
  {
    seq: bigint("seq", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    workspaceId: uuid("workspace_id").notNull(),
    taskId: uuid("task_id").notNull(),
    kind: taskEventKindEnum("kind").notNull(),
    /** `human:<id>` or `agent:<id>`. */
    actor: text("actor").notNull(),
    onBehalfOf: text("on_behalf_of").notNull(),
    /** Null when the caller has no device token. */
    deviceId: uuid("device_id"),
    claimSeq: bigint("claim_seq", { mode: "number" }).notNull(),
    /** The app clock; the default is for seeds only. */
    at: at("at").notNull().defaultNow(),
    /** Ids and states only, never text. */
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [index("task_events_task_seq_idx").on(t.taskId, t.seq)],
);
