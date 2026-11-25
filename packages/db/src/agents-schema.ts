// Agent profiles (docs/vision/AGENTS.md, D25 part 1). A profile belongs to one person; a binding
// says which profile an app the person connected acts as. Only people write either table.
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { AgentKind } from "@sky-brain/shared/agents";
import { createdAt, id } from "./columns.ts";

export const agentProfiles = pgTable(
  "agent_profiles",
  {
    id: id(),
    /** The person who owns the profile; every query filters on it. */
    userId: text("user_id").notNull(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    kind: text("kind").$type<AgentKind>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("agent_profiles_user_slug_unique").on(t.userId, t.slug),
    // The composite target of agent_bindings' foreign key.
    unique("agent_profiles_id_user_unique").on(t.id, t.userId),
    check("agent_profiles_kind", sql`${t.kind} in ('worker', 'steward')`),
  ],
);

export const agentBindings = pgTable(
  "agent_bindings",
  {
    userId: text("user_id").notNull(),
    /** The OAuth client id (`azp` of the access token): a CIMD URL for MCP clients. */
    clientId: text("client_id").notNull(),
    profileId: uuid("profile_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.clientId] }),
    // A binding can only point at a profile of the same person; deleting it unbinds.
    foreignKey({
      name: "agent_bindings_profile_of_user_fk",
      columns: [t.profileId, t.userId],
      foreignColumns: [agentProfiles.id, agentProfiles.userId],
    }).onDelete("cascade"),
  ],
);
