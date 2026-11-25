// Approval requests (docs/vision/HATS-AND-APPROVAL.md Part 2, D31): an agent asks the person to
// approve exact goals or entries; the person decides on sky-brain's own page, in their own
// session. Every item is pinned to the state it was in when asked, so what the person saw is
// what gets approved: a changed item makes the whole request `superseded`.
import type { Actor } from "@sky-brain/shared/actor";
import {
  APPROVAL_CAPS,
  type ApprovalCreateRequest,
  type ApprovalItem,
  type ApprovalRequest,
} from "@sky-brain/shared/approvals";
import type { Role } from "@sky-brain/shared/enums";
import { and, count, desc, eq, gt, inArray, max } from "drizzle-orm";
import { auditActor, personOf } from "@sky-brain/kernel/actor/keys";
import { writeAudit } from "@sky-brain/db/audit";
import type { Db, DbOrTx } from "@sky-brain/db/client";
import {
  approvalRequests,
  entries,
  goals,
  members,
  tasks,
  type PinnedItem,
} from "@sky-brain/db/schema";
import { HttpError } from "@sky-brain/kernel/http/http-error";
import { findEntry, setTrustInTx } from "../memory/entries-service.ts";
import { memberRole } from "@sky-brain/kernel/scope/member-role";
import { approveGoal, findGoal } from "../tasks/goals-service.ts";

export type ApprovalRow = typeof approvalRequests.$inferSelect;

const notFound = () =>
  new HttpError(404, "not_found", "No such approval request.");

/** The state a goal is in, as one string: its status, its last change, and its tasks'. */
async function goalPin(db: DbOrTx, goalId: string): Promise<string | null> {
  const [goal] = await db
    .select({ status: goals.status, updatedAt: goals.updatedAt })
    .from(goals)
    .where(eq(goals.id, goalId));
  if (!goal) return null;
  const [t] = await db
    .select({ n: count(), last: max(tasks.updatedAt) })
    .from(tasks)
    .where(eq(tasks.goalId, goalId));
  return `${goal.status}|${goal.updatedAt.getTime()}|${t?.n ?? 0}|${t?.last?.getTime() ?? 0}`;
}

async function entryPin(db: DbOrTx, entryId: string): Promise<string | null> {
  const [entry] = await db
    .select({ version: entries.version, trust: entries.trust })
    .from(entries)
    .where(eq(entries.id, entryId));
  return entry ? `${entry.trust}|v${entry.version}` : null;
}

const pinOf = (db: DbOrTx, item: { kind: string; id: string }) =>
  item.kind === "goal" ? goalPin(db, item.id) : entryPin(db, item.id);

/**
 * Checks each item exists, the caller may see it, it is waiting for a person (a draft goal, a
 * proposed entry) and all are in one workspace. Returns that workspace and the caller's role.
 */
async function resolveItems(
  db: Db,
  actor: Actor,
  body: ApprovalCreateRequest,
): Promise<{ workspaceId: string; role: Role; pinned: PinnedItem[] }> {
  const found: { workspaceId: string; role: Role; item: PinnedItem }[] = [];
  for (const ref of body.items) {
    if (ref.kind === "goal") {
      const { goal, role } = await findGoal(db, actor, ref.id);
      if (goal.status !== "draft") {
        throw new HttpError(
          409,
          "invalid_state",
          "Only a draft goal waits for approval.",
          {
            field: `item:${ref.id}`,
          },
        );
      }
      found.push({
        workspaceId: goal.workspaceId,
        role,
        item: { ...ref, pin: (await goalPin(db, ref.id))! },
      });
    } else {
      const { entry, role } = await findEntry(db, actor, ref.id);
      if (entry.trust !== "proposed") {
        throw new HttpError(
          409,
          "invalid_state",
          "Only a proposed entry waits for approval.",
          {
            field: `item:${ref.id}`,
          },
        );
      }
      found.push({
        workspaceId: entry.workspaceId,
        role,
        item: { ...ref, pin: (await entryPin(db, ref.id))! },
      });
    }
  }
  const workspaceId = found[0]!.workspaceId;
  if (found.some((f) => f.workspaceId !== workspaceId)) {
    throw new HttpError(
      400,
      "invalid_request",
      "All items must be in one brain.",
      {
        field: "items",
      },
    );
  }
  return {
    workspaceId,
    role: found[0]!.role,
    pinned: found.map((f) => f.item),
  };
}

export async function createApproval(
  db: Db,
  actor: Actor,
  body: ApprovalCreateRequest,
  assertWriter: (role: Role) => void,
  now: Date,
): Promise<ApprovalRow> {
  const { workspaceId, role, pinned } = await resolveItems(db, actor, body);
  assertWriter(role);
  const author = actor.kind === "human" ? actor.user_id : actor.agent_id;
  const [open] = await db
    .select({ n: count() })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.onBehalfOf, personOf(actor)),
        eq(approvalRequests.author, author),
        eq(approvalRequests.status, "pending"),
        gt(approvalRequests.expiresAt, now),
      ),
    );
  if ((open?.n ?? 0) >= APPROVAL_CAPS.openPerActor) {
    throw new HttpError(
      429,
      "too_many_open",
      "Too many approval requests are waiting; let the person answer them first.",
    );
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(approvalRequests)
      .values({
        workspaceId,
        authorKind: actor.kind,
        author,
        onBehalfOf: personOf(actor),
        reason: body.reason,
        items: pinned,
        createdAt: now,
        expiresAt: new Date(now.getTime() + APPROVAL_CAPS.ttlMinutes * 60_000),
      })
      .returning();
    const who = auditActor(actor);
    await writeAudit(tx, {
      workspaceId,
      actor: who.actor,
      action: "approval.request",
      targetId: row!.id,
      details: { ...who.details, items: pinned.length },
    });
    return row!;
  });
}

/** One request the caller may see: their person is a member of its brain. Else 404. */
export async function findApproval(
  db: DbOrTx,
  actor: Actor,
  id: string,
  forUpdate = false,
): Promise<{ row: ApprovalRow; role: Role }> {
  const query = db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, id));
  const [row] = await (forUpdate ? query.for("update") : query);
  if (!row) throw notFound();
  const role = await memberRole(db, row.workspaceId, actor);
  if (!role) throw notFound();
  return { row, role };
}

/** Pending requests in every brain the person is a member of, newest first. */
export async function listPending(
  db: Db,
  actor: Actor,
  now: Date,
): Promise<ApprovalRow[]> {
  return db
    .select({ request: approvalRequests })
    .from(approvalRequests)
    .innerJoin(
      members,
      and(
        eq(members.workspaceId, approvalRequests.workspaceId),
        eq(members.userId, personOf(actor)),
      ),
    )
    .where(
      and(
        eq(approvalRequests.status, "pending"),
        gt(approvalRequests.expiresAt, now),
      ),
    )
    .orderBy(desc(approvalRequests.createdAt), desc(approvalRequests.id))
    .limit(50)
    .then((rows) => rows.map((r) => r.request));
}

/** The status a reader sees: a pending request past its time is expired. */
const statusAt = (row: ApprovalRow, now: Date) =>
  row.status === "pending" && row.expiresAt <= now ? "expired" : row.status;

export async function approvalWire(
  db: DbOrTx,
  actor: Actor,
  row: ApprovalRow,
  now: Date,
): Promise<ApprovalRequest> {
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
        })
        .from(entries)
        .where(
          and(
            inArray(entries.id, entryIds),
            eq(entries.workspaceId, row.workspaceId),
          ),
        )
    : [];
  const byId = new Map([...goalRows, ...entryRows].map((r) => [r.id, r]));
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
    });
  }
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    status: statusAt(row, now),
    reason: row.reason,
    requested_by: row.author,
    items,
    path: `/a/${row.id}`,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    decided_by: row.decidedBy,
    decided_at: row.decidedAt?.toISOString() ?? null,
  };
}

type Outcome = { row: ApprovalRow } | { refused: HttpError };

/**
 * A person approves or rejects, in one transaction with the request locked. Approving checks
 * every pin first: if anything changed, the request becomes `superseded` and nothing is applied.
 * Then each goal is approved and each entry kept through the same code the web's own buttons
 * use, so every rule there (quarantine, role, About me owner only) holds here too.
 */
export async function decideApproval(
  db: Db,
  actor: Actor & { kind: "human" },
  id: string,
  to: "approved" | "rejected",
  assertWriter: (role: Role) => void,
  now: Date,
): Promise<ApprovalRow> {
  const outcome: Outcome = await db.transaction(async (tx) => {
    const { row, role } = await findApproval(tx, actor, id, true);
    assertWriter(role);
    if (row.status !== "pending") {
      throw new HttpError(
        409,
        "invalid_state",
        `This request is already ${row.status}.`,
      );
    }
    const close = async (
      status: "expired" | "superseded",
      refused: HttpError,
    ) => {
      await tx
        .update(approvalRequests)
        .set({ status })
        .where(eq(approvalRequests.id, row.id));
      await audit(tx, actor, row, `approval.${status}`);
      return { refused };
    };
    if (row.expiresAt <= now) {
      return close(
        "expired",
        new HttpError(410, "expired", "This request has expired."),
      );
    }
    if (to === "approved") {
      for (const item of row.items) {
        if ((await pinOf(tx, item)) !== item.pin) {
          return close(
            "superseded",
            new HttpError(
              409,
              "superseded",
              "Something changed since this was asked; nothing was applied.",
              {
                field: `item:${item.id}`,
              },
            ),
          );
        }
      }
      for (const item of row.items) {
        if (item.kind === "goal") {
          const { goal } = await findGoal(tx, actor, item.id, true);
          await approveGoal(tx, actor, goal, now);
        } else {
          await setTrustInTx(tx, actor, item.id, "approved");
        }
      }
    }
    const [done] = await tx
      .update(approvalRequests)
      .set({ status: to, decidedBy: actor.user_id, decidedAt: now })
      .where(eq(approvalRequests.id, row.id))
      .returning();
    await audit(
      tx,
      actor,
      row,
      to === "approved" ? "approval.approve" : "approval.reject",
    );
    return { row: done! };
  });
  if ("refused" in outcome) throw outcome.refused;
  return outcome.row;
}

async function audit(
  tx: DbOrTx,
  actor: Actor,
  row: ApprovalRow,
  action: string,
) {
  const who = auditActor(actor);
  await writeAudit(tx, {
    workspaceId: row.workspaceId,
    actor: who.actor,
    action,
    targetId: row.id,
    details: { ...who.details, items: row.items.length, channel: "web" },
  });
}
