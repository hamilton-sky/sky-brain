// Approval requests (docs/vision/HATS-AND-APPROVAL.md Part 2, D31), re-exported from schema.ts.
// An agent asks; only a person decides, on the web, in their own session.
import type {
  ApprovalItemKind,
  ApprovalStatus,
} from "@sky-brain/shared/approvals";
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, createdBy, id } from "./columns.ts";
import { workspaces } from "./schema.ts";

/** An item and the state it was in when the request was made (`pin`). */
export interface PinnedItem {
  kind: ApprovalItemKind;
  id: string;
  pin: string;
}

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ...createdBy(),
    reason: text("reason").notNull(),
    items: jsonb("items").$type<PinnedItem[]>().notNull(),
    status: text("status").$type<ApprovalStatus>().notNull().default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: at("decided_at"),
    createdAt: createdAt(),
    expiresAt: at("expires_at").notNull(),
  },
  (t) => [
    index("approval_requests_workspace_status_idx").on(t.workspaceId, t.status),
    check(
      "approval_requests_status",
      sql`${t.status} in ('pending', 'approved', 'rejected', 'expired', 'superseded')`,
    ),
    check(
      "approval_requests_author_kind",
      sql`${t.authorKind} in ('human', 'agent')`,
    ),
    // A decided request names who decided and when; a pending one names nobody.
    check(
      "approval_requests_decided",
      sql`(${t.status} in ('approved', 'rejected')) = (${t.decidedBy} is not null and ${t.decidedAt} is not null)`,
    ),
  ],
);
