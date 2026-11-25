// Column helpers the schema modules share. It imports no table, so any schema module may use it
// whatever order they load in.
import type { AuthorKind } from "@sky-brain/shared/enums";
import { sql } from "drizzle-orm";
import { text, timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();
export const at = (name: string) => timestamp(name, { withTimezone: true });
export const createdAt = () => at("created_at").notNull().defaultNow();

/** A text[] column that defaults to empty. */
export const textArray = (name: string) =>
  text(name)
    .array()
    .notNull()
    .default(sql`'{}'`);

/** Who wrote the row: text with a check, not the `author_kind` enum (see tasks-schema.ts). */
export const createdBy = () => ({
  authorKind: text("author_kind").$type<AuthorKind>().notNull(),
  author: text("author").notNull(),
  onBehalfOf: text("on_behalf_of").notNull(),
});
