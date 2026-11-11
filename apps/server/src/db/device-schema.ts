// Device login tables (cloud-task-board spec.md Design), re-exported from schema.ts so
// drizzle.config.ts and client.ts see them. After a change, run
// `pnpm --filter @sky-brain/server exec drizzle-kit generate`.
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { RunTokenRole, Verb } from "@sky-brain/shared/run-tokens";
import { devices, projects } from "./schema.ts";

const at = (name: string) => timestamp(name, { withTimezone: true });

/** One RFC 8628 device authorization: pending, then approved, then its token issued once. */
export const deviceCodes = pgTable(
  "device_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 hex of the device code; the code itself is never stored. */
    deviceCodeHash: text("device_code_hash").notNull().unique(),
    /** Eight letters from BCDFGHJKLMNPQRSTVWXZ, stored without the dash. */
    userCode: text("user_code").notNull(),
    clientName: text("client_name").notNull(),
    expiresAt: at("expires_at").notNull(),
    intervalSeconds: integer("interval_seconds").notNull(),
    lastPolledAt: at("last_polled_at"),
    /** The person who approved it. */
    approvedBy: text("approved_by"),
    /** Set on approval; a code with a device is no longer pending. */
    deviceId: uuid("device_id").references(() => devices.id),
    /** Set when the device token was handed out; any later poll is `invalid_grant`. */
    issuedAt: at("issued_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("device_codes_pending_user_code_idx")
      .on(t.userCode)
      .where(sql`${t.deviceId} is null`),
    // The purge on every /api/device/code deletes pending codes by expiry; no full scan.
    index("device_codes_pending_expires_at_idx")
      .on(t.expiresAt)
      .where(sql`${t.deviceId} is null`),
  ],
);

/** A run token (`sbr_`): at most 30 minutes, bound to a device, a project, a role and verbs. */
export const runTokens = pgTable(
  "run_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 hex of the run token; the token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull(),
    projectId: uuid("project_id").notNull(),
    /**
     * `editor` or `viewer`; never `owner`. Text with a check, not schema.ts's `role` enum: this
     * module loads before schema.ts finishes (schema.ts re-exports it), so the enum is not
     * defined yet when this table is built.
     */
    role: text("role").$type<RunTokenRole>().notNull(),
    verbs: text("verbs").array().$type<Verb[]>().notNull(),
    expiresAt: at("expires_at").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "run_tokens_project_in_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    check("run_tokens_role", sql`${t.role} in ('editor', 'viewer')`),
    index("run_tokens_device_idx").on(t.deviceId),
  ],
);
