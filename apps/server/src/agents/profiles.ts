// Agent profiles and bindings (D25 part 1): the queries, each filtered by the owning person
// (hard rule 4 holds per person here, because a profile belongs to a person, not a workspace).
import type { AgentProfileRef } from "@sky-brain/shared/actor";
import type {
  AgentProfile,
  AgentProfileCreateRequest,
  ConnectedApp,
} from "@sky-brain/shared/agents";
import type { Actor } from "@sky-brain/shared/actor";
import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@sky-brain/db/client";
import {
  agentBindings,
  agentProfiles,
  oauthClient,
  oauthConsent,
} from "@sky-brain/db/schema";

type ProfileRow = typeof agentProfiles.$inferSelect;

function toWire(row: ProfileRow): AgentProfile {
  return {
    id: row.id,
    slug: row.slug,
    display_name: row.displayName,
    kind: row.kind,
    created_at: row.createdAt.toISOString(),
  };
}

export async function listProfiles(
  db: DbOrTx,
  person: string,
): Promise<AgentProfile[]> {
  const rows = await db
    .select()
    .from(agentProfiles)
    .where(eq(agentProfiles.userId, person))
    .orderBy(asc(agentProfiles.createdAt), asc(agentProfiles.slug));
  return rows.map(toWire);
}

/** Undefined when the person already has a profile with that slug. */
export async function createProfile(
  db: DbOrTx,
  person: string,
  request: AgentProfileCreateRequest,
): Promise<AgentProfile | undefined> {
  const [row] = await db
    .insert(agentProfiles)
    .values({
      userId: person,
      slug: request.slug,
      displayName: request.display_name,
      kind: request.kind,
    })
    .onConflictDoNothing()
    .returning();
  return row ? toWire(row) : undefined;
}

/** False when the person has no such profile. Its bindings go with it (cascade). */
export async function deleteProfile(
  db: DbOrTx,
  person: string,
  profileId: string,
): Promise<boolean> {
  const rows = await db
    .delete(agentProfiles)
    .where(
      and(eq(agentProfiles.id, profileId), eq(agentProfiles.userId, person)),
    )
    .returning({ id: agentProfiles.id });
  return rows.length > 0;
}

/** The apps the person allowed on the consent page, with the profile each acts as. */
export async function listConnectedApps(
  db: DbOrTx,
  person: string,
): Promise<ConnectedApp[]> {
  const rows = await db
    .selectDistinct({
      clientId: oauthConsent.clientId,
      name: oauthClient.name,
      profileId: agentBindings.profileId,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .leftJoin(
      agentBindings,
      and(
        eq(agentBindings.userId, person),
        eq(agentBindings.clientId, oauthConsent.clientId),
      ),
    )
    .where(eq(oauthConsent.userId, person))
    .orderBy(asc(oauthConsent.clientId));
  return rows.map((r) => ({
    client_id: r.clientId,
    name: r.name,
    profile_id: r.profileId,
  }));
}

export type BindResult = "bound" | "unbound" | "no_app" | "no_profile";

/**
 * Bind an app the person consented to one of their profiles, or unbind it (`null`). The
 * composite foreign key also refuses another person's profile.
 */
export async function bindApp(
  db: DbOrTx,
  person: string,
  clientId: string,
  profileId: string | null,
): Promise<BindResult> {
  const [consent] = await db
    .select({ id: oauthConsent.id })
    .from(oauthConsent)
    .where(
      and(eq(oauthConsent.userId, person), eq(oauthConsent.clientId, clientId)),
    )
    .limit(1);
  if (!consent) return "no_app";
  if (profileId === null) {
    await db
      .delete(agentBindings)
      .where(
        and(
          eq(agentBindings.userId, person),
          eq(agentBindings.clientId, clientId),
        ),
      );
    return "unbound";
  }
  const [profile] = await db
    .select({ id: agentProfiles.id })
    .from(agentProfiles)
    .where(
      and(eq(agentProfiles.id, profileId), eq(agentProfiles.userId, person)),
    );
  if (!profile) return "no_profile";
  await db
    .insert(agentBindings)
    .values({ userId: person, clientId, profileId })
    .onConflictDoUpdate({
      target: [agentBindings.userId, agentBindings.clientId],
      set: { profileId, createdAt: new Date() },
    });
  return "bound";
}

/** The profile the person bound this app to; undefined for the Guest agent. */
export async function boundProfile(
  db: DbOrTx,
  person: string,
  clientId: string,
): Promise<AgentProfileRef | undefined> {
  const [row] = await db
    .select({
      id: agentProfiles.id,
      slug: agentProfiles.slug,
      display_name: agentProfiles.displayName,
    })
    .from(agentBindings)
    .innerJoin(
      agentProfiles,
      and(
        eq(agentProfiles.id, agentBindings.profileId),
        eq(agentProfiles.userId, agentBindings.userId),
      ),
    )
    .where(
      and(
        eq(agentBindings.userId, person),
        eq(agentBindings.clientId, clientId),
      ),
    );
  return row;
}

/**
 * The agent as its profile: `agent_id` becomes `<client agent id>/<slug>`, so audit rows, task
 * events, claims and entry authors all name the role without a schema change. A human, or an
 * agent with no profile, is returned as it is.
 */
export function withProfile(
  actor: Actor,
  profile: AgentProfileRef | undefined,
): Actor {
  if (actor.kind !== "agent" || !profile) return actor;
  return { ...actor, agent_id: `${actor.agent_id}/${profile.slug}`, profile };
}
