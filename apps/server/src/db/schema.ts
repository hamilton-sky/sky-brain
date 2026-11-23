// The Drizzle schema of docs/PLAN.md section 5. After a change, run
// `pnpm --filter @sky-brain/server exec drizzle-kit generate`.
import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { AUTHOR_KINDS, ROLES } from "@sky-brain/shared/enums";
import { at, createdAt, id } from "./columns.ts";

export const roleEnum = pgEnum("role", ROLES);
export const authorKindEnum = pgEnum("author_kind", AUTHOR_KINDS);

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const members = pgTable(
  "members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const invites = pgTable(
  "invites",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: roleEnum("role").notNull(),
    invitedBy: text("invited_by").notNull(),
    createdAt: createdAt(),
    acceptedAt: at("accepted_at"),
  },
  (t) => [unique().on(t.workspaceId, t.email)],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    gitRemote: text("git_remote"),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.workspaceId, t.slug),
    unique().on(t.workspaceId, t.gitRemote),
    unique().on(t.id, t.workspaceId),
  ],
);

export const features = pgTable(
  "features",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    archivedAt: at("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.projectId, t.slug), unique().on(t.id, t.projectId)],
);

/** Append-only: a trigger refuses UPDATE, DELETE and TRUNCATE. No foreign key on workspace_id. */
export const auditLog = pgTable(
  "audit_log",
  {
    seq: bigint("seq", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    workspaceId: uuid("workspace_id").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetId: uuid("target_id"),
    at: at("at").notNull().defaultNow(),
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [index("audit_log_workspace_seq_idx").on(t.workspaceId, t.seq)],
);

export const devices = pgTable("devices", {
  id: id(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  lastSeenAt: at("last_seen_at"),
  revokedAt: at("revoked_at"),
  /** SHA-256 hex of the device token (`sbd_`); null until the device flow hands it out. */
  secretHash: text("secret_hash").unique(),
});

// Better Auth's tables (login-mcp), so the Db type and drizzle-kit see them.
export * from "./auth-schema.ts";
// Device login and run tokens (cloud-task-board).
export * from "./device-schema.ts";
export * from "./tasks-schema.ts";
// The memory core: memories, entries and their versions (step 1).
export * from "./memory-schema.ts";
// Agent profiles and which app acts as which (D25).
export * from "./agents-schema.ts";
