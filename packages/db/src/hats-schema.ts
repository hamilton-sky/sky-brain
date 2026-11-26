// Hats (D30, docs/vision/HATS-AND-APPROVAL.md Part 1): one brain, several self-aspects. A hat
// belongs to one brain (workspace) and only narrows what an agent sees; it never grants a right.
// Only people write these tables (hard rule 3). A brain starts with no hats, which behaves
// exactly as before.
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns.ts";
import { entries } from "./memory-schema.ts";
import { workspaces } from "./schema.ts";

export const hats = pgTable(
  "hats",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** How this hat talks and decides, written by the person. */
    description: text("description").notNull().default(""),
    color: text("color"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("hats_ws_slug_unique").on(t.workspaceId, t.slug),
    // The composite target of core_entry_hats' foreign key.
    unique("hats_id_ws_unique").on(t.id, t.workspaceId),
    check("hats_slug_format", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,39}$'`),
    check("hats_name_length", sql`char_length(${t.name}) between 1 and 60`),
  ],
);

/**
 * Which hats an About me entry is true in. No row means the shared self (every hat); one or
 * more rows mean "true about me in these roles". About me stays one memory (one core per brain).
 */
export const coreEntryHats = pgTable(
  "core_entry_hats",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    hatId: uuid("hat_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "core_entry_hats_pk", columns: [t.entryId, t.hatId] }),
    // The hat is in the entry's own brain; deleting the hat removes its tags.
    foreignKey({
      name: "core_entry_hats_hat_in_ws_fk",
      columns: [t.hatId, t.workspaceId],
      foreignColumns: [hats.id, hats.workspaceId],
    }).onDelete("cascade"),
    index("core_entry_hats_hat_idx").on(t.hatId),
  ],
);
