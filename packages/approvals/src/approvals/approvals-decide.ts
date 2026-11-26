// A person decides an approval request (D31, D39), in one transaction with the request locked.
// They may decide each item: approve (optionally keeping an entry in another memory), reject, or
// skip (it stays as it was). Every item they decide is checked against the state they were shown
// first: if one changed, the request becomes `superseded` and nothing is applied. Each change
// goes through the same code the web's own buttons use, so every rule there holds here too.
import type { Actor } from "@sky-brain/shared/actor";
import { MEMORY_CAPS, type CaptureRequest } from "@sky-brain/shared/memory";
import type {
  ApprovalDecideRequest,
  ItemAction,
} from "@sky-brain/shared/approvals";
import type { Role } from "@sky-brain/shared/enums";
import { eq } from "drizzle-orm";
import { auditActor } from "@sky-brain/kernel/actor/keys";
import { writeAudit } from "@sky-brain/db/audit";
import type { Db, DbOrTx } from "@sky-brain/db/client";
import { approvalRequests, type PinnedItem } from "@sky-brain/db/schema";
import { HttpError } from "@sky-brain/kernel/http/http-error";
import {
  captureInTx,
  findEntry,
  setTrustInTx,
} from "@sky-brain/memory/entries-service";
import {
  approveGoal,
  cancelGoal,
  findGoal,
} from "@sky-brain/board/tasks/goals-service";
import {
  assertTarget,
  findApproval,
  pinOf,
  type ApprovalRow,
} from "./approvals-service.ts";

type Outcome = { row: ApprovalRow } | { refused: HttpError };
type Human = Actor & { kind: "human" };
interface Plan {
  item: PinnedItem;
  action: ItemAction;
  saveTo?: string;
}

/** What to do with each item: the body's choice, or approve all (with the suggested memory). */
function planOf(row: ApprovalRow, body: ApprovalDecideRequest): Plan[] {
  if (!body.items) {
    return row.items.map((item) => ({
      item,
      action: "approve",
      saveTo: item.saveTo,
    }));
  }
  const chosen = new Map(body.items.map((i) => [i.id, i]));
  const unknown = body.items.find(
    (i) => !row.items.some((it) => it.id === i.id),
  );
  if (unknown) {
    throw new HttpError(
      400,
      "invalid_request",
      "No such item in this request.",
      {
        field: `item:${unknown.id}`,
      },
    );
  }
  const plan = row.items.map((item): Plan => {
    const c = chosen.get(item.id);
    return { item, action: c?.action ?? "skip", saveTo: c?.save_to };
  });
  if (plan.every((p) => p.action === "skip")) {
    throw new HttpError(
      400,
      "invalid_request",
      "Pick at least one item to approve or reject.",
      { field: "items" },
    );
  }
  for (const p of plan) {
    if (p.saveTo !== undefined && p.item.kind !== "entry") {
      throw new HttpError(
        400,
        "invalid_request",
        "Only an entry is kept in a memory.",
        {
          field: `item:${p.item.id}`,
        },
      );
    }
  }
  return plan;
}

/**
 * Keeps an approved entry in another memory: the person's own copy there, approved (unless its
 * text is held), pointing back to the original with an `entry:<id>` ref. Only the owner keeps
 * something in About me (captureInTx refuses anyone else).
 */
async function keepIn(
  tx: DbOrTx,
  actor: Human,
  entryId: string,
  memoryId: string,
  now: Date,
): Promise<string | undefined> {
  const { entry } = await findEntry(tx, actor, entryId);
  if (memoryId === entry.memoryId) return undefined;
  await assertTarget(tx, actor, entry.workspaceId, memoryId);
  const refs = [...entry.refs, `entry:${entry.id}`].slice(-MEMORY_CAPS.refs);
  const copy: CaptureRequest = {
    memory_id: memoryId,
    kind: entry.kind,
    ...(entry.topic ? { topic: entry.topic } : {}),
    title: entry.title,
    body: entry.body,
    summary: entry.summary,
    questions: entry.questions,
    refs,
    ...(entry.source === "web" || entry.source === "import"
      ? { source: entry.source }
      : {}),
  };
  const row = await captureInTx(tx, actor, copy, now);
  return row.id;
}

async function apply(
  tx: DbOrTx,
  actor: Human,
  p: Plan,
  now: Date,
): Promise<PinnedItem> {
  const { item, action } = p;
  if (action === "skip") return { ...item, outcome: "skipped" };
  if (item.kind === "goal") {
    const { goal } = await findGoal(tx, actor, item.id, true);
    if (action === "approve") await approveGoal(tx, actor, goal, now);
    else await cancelGoal(tx, actor, goal, now);
    return { ...item, outcome: action === "approve" ? "approved" : "rejected" };
  }
  if (action === "reject") {
    await setTrustInTx(tx, actor, item.id, "rejected");
    return { ...item, outcome: "rejected" };
  }
  await setTrustInTx(tx, actor, item.id, "approved");
  const savedAs =
    p.saveTo === undefined
      ? undefined
      : await keepIn(tx, actor, item.id, p.saveTo, now);
  return {
    ...item,
    outcome: "approved",
    ...(savedAs ? { savedAs } : {}),
  };
}

export async function decideApproval(
  db: Db,
  actor: Human,
  id: string,
  to: "approved" | "rejected",
  body: ApprovalDecideRequest,
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
    let items = row.items;
    let status = to;
    if (to === "approved") {
      const plan = planOf(row, body);
      for (const p of plan) {
        if (p.action === "skip") continue;
        if ((await pinOf(tx, p.item)) !== p.item.pin) {
          return close(
            "superseded",
            new HttpError(
              409,
              "superseded",
              "Something changed since this was asked; nothing was applied.",
              { field: `item:${p.item.id}` },
            ),
          );
        }
      }
      items = [];
      for (const p of plan) items.push(await apply(tx, actor, p, now));
      if (!items.some((i) => i.outcome === "approved")) status = "rejected";
    }
    const [done] = await tx
      .update(approvalRequests)
      .set({ status, items, decidedBy: actor.user_id, decidedAt: now })
      .where(eq(approvalRequests.id, row.id))
      .returning();
    await audit(
      tx,
      actor,
      done!,
      status === "approved" ? "approval.approve" : "approval.reject",
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
  const count = (o: string) => row.items.filter((i) => i.outcome === o).length;
  await writeAudit(tx, {
    workspaceId: row.workspaceId,
    actor: who.actor,
    action,
    targetId: row.id,
    details: {
      ...who.details,
      items: row.items.length,
      approved: count("approved"),
      rejected: count("rejected"),
      kept_elsewhere: row.items.filter((i) => i.savedAs).length,
      channel: "web",
    },
  });
}
