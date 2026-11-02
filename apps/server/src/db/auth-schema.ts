// Device login tables (cloud-task-board spec.md Design), re-exported from schema.ts so
// drizzle.config.ts and client.ts see them. After a change, run
// `pnpm --filter @sky-brain/server exec drizzle-kit generate`.
import { sql } from "drizzle-orm";
import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { devices } from "./schema.ts";

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
  ],
);
