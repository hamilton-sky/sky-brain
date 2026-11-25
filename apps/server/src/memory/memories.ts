// Memories: the containers of a brain (MEMORY-SCHEMA.md § 2). Each brain has exactly one About
// me (core), made with its default Inbox and Notebook when the workspace is made. Who may read
// or write which memory is decided here, from membership, never from the request body.
import type { Actor } from "@sky-brain/shared/actor";
import type { Role } from "@sky-brain/shared/enums";
import type { Memory, MemoryLayer } from "@sky-brain/shared/memory";
import { and, asc, eq, inArray } from "drizzle-orm";
import { personOf } from "@sky-brain/kernel/actor/keys";
import type { DbOrTx } from "@sky-brain/db/client";
import { members, memories } from "@sky-brain/db/schema";
import { HttpError } from "@sky-brain/kernel/http/http-error";

export type MemoryRow = typeof memories.$inferSelect;

/** The three memories every brain starts with. */
const DEFAULTS: { layer: MemoryLayer; name: string }[] = [
  { layer: "core", name: "About me" },
  { layer: "short", name: "Inbox" },
  { layer: "long", name: "Notebook" },
];

/** Makes About me, the default Inbox and the default Notebook of a new workspace. */
export async function createDefaultMemories(
  tx: DbOrTx,
  workspaceId: string,
): Promise<void> {
  await tx
    .insert(memories)
    .values(DEFAULTS.map((d) => ({ workspaceId, ...d, isDefault: true })));
}

export function memoryWire(row: MemoryRow): Memory {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    layer: row.layer,
    name: row.name,
    is_default: row.isDefault,
    created_at: row.createdAt.toISOString(),
  };
}

/** The caller's workspaces and roles; one workspace when `workspaceId` is given (404 if none). */
export async function workspaceRoles(
  db: DbOrTx,
  actor: Actor,
  workspaceId?: string,
): Promise<Map<string, Role>> {
  const rows = await db
    .select({ workspaceId: members.workspaceId, role: members.role })
    .from(members)
    .where(
      and(
        eq(members.userId, personOf(actor)),
        workspaceId ? eq(members.workspaceId, workspaceId) : undefined,
      ),
    );
  if (workspaceId && rows.length === 0) {
    throw new HttpError(404, "not_found", "No such workspace.");
  }
  return new Map(rows.map((r) => [r.workspaceId, r.role]));
}

/** About me is the owner's alone: a member who is not the owner never sees it. */
function mayReadMemory(layer: MemoryLayer, role: Role): boolean {
  return layer !== "core" || role === "owner";
}

/** The memories the caller may read, oldest first. */
export async function listMemories(
  db: DbOrTx,
  actor: Actor,
  workspaceId?: string,
): Promise<MemoryRow[]> {
  const roles = await workspaceRoles(db, actor, workspaceId);
  if (roles.size === 0) return [];
  const rows = await db
    .select()
    .from(memories)
    .where(inArray(memories.workspaceId, [...roles.keys()]))
    .orderBy(asc(memories.createdAt), asc(memories.layer));
  return rows.filter((m) => mayReadMemory(m.layer, roles.get(m.workspaceId)!));
}

/** One memory the caller may read, with their role there; 404 otherwise. */
export async function findMemory(
  db: DbOrTx,
  actor: Actor,
  memoryId: string,
): Promise<{ memory: MemoryRow; role: Role }> {
  const [row] = await db
    .select({ memory: memories, role: members.role })
    .from(memories)
    .innerJoin(
      members,
      and(
        eq(members.workspaceId, memories.workspaceId),
        eq(members.userId, personOf(actor)),
      ),
    )
    .where(eq(memories.id, memoryId));
  if (!row || !mayReadMemory(row.memory.layer, row.role)) {
    throw new HttpError(404, "not_found", "No such memory.");
  }
  return row;
}

/**
 * The workspace a write without a workspace id goes to: the one the caller owns (their own
 * brain, D17). 404 when they own none.
 */
export async function ownWorkspace(db: DbOrTx, actor: Actor): Promise<string> {
  const [row] = await db
    .select({ workspaceId: members.workspaceId })
    .from(members)
    .where(and(eq(members.userId, personOf(actor)), eq(members.role, "owner")))
    .orderBy(asc(members.createdAt))
    .limit(1);
  if (!row) throw new HttpError(404, "not_found", "No brain of your own.");
  return row.workspaceId;
}

/** The default memory of a layer in a workspace (made at sign-in or by migration 0008). */
export async function defaultMemory(
  db: DbOrTx,
  workspaceId: string,
  layer: MemoryLayer,
): Promise<MemoryRow> {
  const [row] = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.workspaceId, workspaceId),
        eq(memories.layer, layer),
        eq(memories.isDefault, true),
      ),
    );
  if (!row) {
    throw new HttpError(
      404,
      "not_found",
      `This brain has no default ${layer} memory.`,
    );
  }
  return row;
}
