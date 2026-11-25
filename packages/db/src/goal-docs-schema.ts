// Documents attached to a goal: a goal points at entries (markdown with a summary the writer
// gave) so the board can show their summaries and the person can read and edit them. The link
// only; the text, its summary and its versions stay in `entries` (memory-schema.ts). The goal
// and the entry are in the same workspace; the service checks that before it inserts.
import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { createdAt, createdBy } from "./columns.ts";
import { entries } from "./memory-schema.ts";
import { goals } from "./tasks-schema.ts";

export const goalDocuments = pgTable(
  "goal_documents",
  {
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull(),
    ...createdBy(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "goal_documents_pk", columns: [t.goalId, t.entryId] }),
    index("goal_documents_entry_idx").on(t.entryId),
    check(
      "goal_documents_author_kind",
      sql`${t.authorKind} in ('human', 'agent')`,
    ),
  ],
);
