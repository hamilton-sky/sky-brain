// Web push subscriptions (D31 alerts, D33), re-exported from schema.ts. One row per browser or
// phone a person turned notifications on in. Only that person writes or reads their rows.
import { index, pgTable, text } from "drizzle-orm/pg-core";
import { at, createdAt, id } from "./columns.ts";

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: text("user_id").notNull(),
    /** The push service URL; unique, so subscribing again from one browser updates it. */
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: createdAt(),
    lastSentAt: at("last_sent_at"),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);
