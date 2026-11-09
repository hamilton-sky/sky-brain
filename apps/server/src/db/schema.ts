// The Drizzle schema of docs/PLAN.md section 5. After a change, run
// `pnpm --filter @sky-brain/server exec drizzle-kit generate`.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  AUTHOR_KINDS,
  KINDS,
  ROLES,
  SOURCES,
  STATUSES,
} from "@sky-brain/shared/enums";

export const roleEnum = pgEnum("role", ROLES);
export const kindEnum = pgEnum("entry_kind", KINDS);
export const statusEnum = pgEnum("entry_status", STATUSES);
export const sourceEnum = pgEnum("entry_source", SOURCES);
export const authorKindEnum = pgEnum("author_kind", AUTHOR_KINDS);

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const id = () => uuid("id").primaryKey().defaultRandom();
const at = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => at("created_at").notNull().defaultNow();

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

/** Every insert and every status change draws from it, so `since=<seq>` sees changes. */
export const entriesSeq = pgSequence("entries_seq");

export const entries = pgTable(
  "entries",
  {
    id: id(),
    seq: bigint("seq", { mode: "number" })
      .notNull()
      .unique()
      .default(sql`nextval('entries_seq')`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    featureId: uuid("feature_id"),
    kind: kindEnum("kind").notNull(),
    status: statusEnum("status").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    authorKind: authorKindEnum("author_kind").notNull(),
    author: text("author").notNull(),
    onBehalfOf: text("on_behalf_of").notNull(),
    source: sourceEnum("source").notNull(),
    refs: text("refs")
      .array()
      .notNull()
      .default(sql`'{}'`),
    replyTo: uuid("reply_to").references((): AnyPgColumn => entries.id),
    supersedes: uuid("supersedes").references((): AnyPgColumn => entries.id),
    confidence: real("confidence"),
    expiresAt: at("expires_at"),
    allowAgentAnswers: boolean("allow_agent_answers").notNull().default(false),
    /** The quarantine pattern that held the entry, written once when it is stored. */
    quarantinedBecause: text("quarantined_because"),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', "title"), 'A') || setweight(to_tsvector('english', "body"), 'B')`,
    ),
  },
  (t) => [
    check(
      "entries_confidence_range",
      sql`${t.confidence} is null or (${t.confidence} >= 0 and ${t.confidence} <= 1)`,
    ),
    check(
      "entries_feature_needs_project",
      sql`${t.featureId} is null or ${t.projectId} is not null`,
    ),
    foreignKey({
      name: "entries_project_in_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "entries_feature_in_project_fk",
      columns: [t.featureId, t.projectId],
      foreignColumns: [features.id, features.projectId],
    }).onDelete("cascade"),
    index("entries_search_idx").using("gin", t.search),
    index("entries_workspace_seq_idx").on(t.workspaceId, t.seq),
    index("entries_scope_idx").on(
      t.workspaceId,
      t.projectId,
      t.featureId,
      t.kind,
      t.status,
    ),
    index("entries_reply_to_idx").on(t.replyTo),
    index("entries_supersedes_idx").on(t.supersedes),
  ],
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
});

// Better Auth's tables (login-mcp), so the Db type and drizzle-kit see them.
export * from "./auth-schema.ts";
