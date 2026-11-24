// Comments on an entry (packages/shared/src/comments.ts): a note on a passage, by a person.
// The entry's workspace is copied so every read filters by it; the service checks the entry
// is readable before it touches a comment.
import type { CommentColor } from "@sky-brain/shared/comments";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { at, createdAt, createdBy, id } from "./columns.ts";
import { entries } from "./memory-schema.ts";

export const entryComments = pgTable(
  "entry_comments",
  {
    id: id(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull(),
    quote: text("quote"),
    body: text("body").notNull(),
    color: text("color").$type<CommentColor>().notNull().default("yellow"),
    resolved: boolean("resolved").notNull().default(false),
    resolvedBy: text("resolved_by"),
    resolvedAt: at("resolved_at"),
    ...createdBy(),
    createdAt: createdAt(),
  },
  (t) => [
    index("entry_comments_entry_idx").on(t.entryId, t.createdAt),
    check(
      "entry_comments_color",
      sql`${t.color} in ('yellow', 'green', 'blue', 'purple', 'orange')`,
    ),
    check(
      "entry_comments_author_kind",
      sql`${t.authorKind} in ('human', 'agent')`,
    ),
    check("entry_comments_body_len", sql`char_length(${t.body}) <= 2000`),
    check(
      "entry_comments_quote_len",
      sql`${t.quote} is null or char_length(${t.quote}) <= 500`,
    ),
  ],
);
