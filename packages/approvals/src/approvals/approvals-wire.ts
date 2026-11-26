// An approval request as a reader sees it: each item as it is now, whether it changed since it
// was asked, what was decided for it, and (for people) the memories an entry can be kept in.
import type { Actor } from "@sky-brain/shared/actor";
import type {
  ApprovalItem,
  ApprovalRequest,
  ApprovalTarget,
} from "@sky-brain/shared/approvals";
import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@sky-brain/db/client";
import { entries, goals } from "@sky-brain/db/schema";
import { listMemories } from "@sky-brain/memory/memories";
import { memberRole } from "@sky-brain/kernel/scope/member-role";
import { pinOf, type ApprovalRow } from "./approvals-service.ts";

/** The status a reader sees: a pending request past its time is expired. */
const statusAt = (row: ApprovalRow, now: Date) =>
  row.status === "pending" && row.expiresAt <= now ? "expired" : row.status;

/** Where a person may keep an approved entry: memories they may write, About me for the owner. */
async function targetsFor(
  db: DbOrTx,
  actor: Actor,
  workspaceId: string,
): Promise<ApprovalTarget[]> {
  if (actor.kind !== "human") return [];
  const role = await memberRole(db, workspaceId, actor);
  if (role !== "owner" && role !== "editor") return [];
  const rows = await listMemories(db, actor, workspaceId);
  const order = { core: 0, long: 1, short: 2 } as const;
  return rows
    .filter((m) => m.layer !== "working")
    .map((m) => ({
      id: m.id,
      name: m.name,
      layer: m.layer as ApprovalTarget["layer"],
    }))
    .sort((a, b) => order[a.layer] - order[b.layer]);
}

async function currentRows(db: DbOrTx, row: ApprovalRow) {
  const goalIds = row.items.filter((i) => i.kind === "goal").map((i) => i.id);
  const entryIds = row.items.filter((i) => i.kind === "entry").map((i) => i.id);
  const goalRows = goalIds.length
    ? await db
        .select({
          id: goals.id,
          title: goals.title,
          state: goals.status,
          held: goals.quarantinedBecause,
        })
        .from(goals)
        .where(
          and(
            inArray(goals.id, goalIds),
            eq(goals.workspaceId, row.workspaceId),
          ),
        )
    : [];
  const entryRows = entryIds.length
    ? await db
        .select({
          id: entries.id,
          title: entries.title,
          state: entries.trust,
          held: entries.quarantinedBecause,
          memoryId: entries.memoryId,
        })
        .from(entries)
        .where(
          and(
            inArray(entries.id, entryIds),
            eq(entries.workspaceId, row.workspaceId),
          ),
        )
    : [];
  return new Map<
    string,
    { title: string; state: string; held: string | null; memoryId?: string }
  >([...goalRows, ...entryRows].map((r) => [r.id, r]));
}

export async function approvalWire(
  db: DbOrTx,
  actor: Actor,
  row: ApprovalRow,
  now: Date,
): Promise<ApprovalRequest> {
  const byId = await currentRows(db, row);
  const items: ApprovalItem[] = [];
  for (const item of row.items) {
    const current = byId.get(item.id);
    // Agents never see held text (hard rule 6), not even a title.
    const hidden =
      !current || (actor.kind === "agent" && current.held !== null);
    items.push({
      kind: item.kind,
      id: item.id,
      title: hidden ? "(not available)" : current.title,
      state: current ? String(current.state) : "gone",
      changed: (await pinOf(db, item)) !== item.pin,
      memory_id: current?.memoryId ?? null,
      save_to: item.saveTo ?? null,
      outcome: item.outcome ?? null,
      saved_as: item.savedAs ?? null,
    });
  }
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    status: statusAt(row, now),
    reason: row.reason,
    requested_by: row.author,
    items,
    targets:
      statusAt(row, now) === "pending"
        ? await targetsFor(db, actor, row.workspaceId)
        : [],
    path: `/a/${row.id}`,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    decided_by: row.decidedBy,
    decided_at: row.decidedAt?.toISOString() ?? null,
  };
}
