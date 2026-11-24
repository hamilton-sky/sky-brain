// Approval requests (docs/vision/HATS-AND-APPROVAL.md Part 2, D31). An agent asks the person to
// approve exact items; the person answers on a sky-brain page in their own session. A tool
// argument or chat text is never an approval (hard rule 3).
import { z } from "zod";
import { IdSchema } from "./scope.ts";

export const APPROVAL_ITEM_KINDS = ["goal", "entry"] as const;
export type ApprovalItemKind = (typeof APPROVAL_ITEM_KINDS)[number];

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "superseded",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_CAPS = {
  items: 20,
  reason: 300,
  /** Open (pending, not expired) requests one person may have from one actor. */
  openPerActor: 10,
  /** Minutes until a pending request expires. */
  ttlMinutes: 60,
} as const;

export const ApprovalItemSchema = z.strictObject({
  kind: z.enum(APPROVAL_ITEM_KINDS),
  id: IdSchema,
});
export type ApprovalItemRef = z.infer<typeof ApprovalItemSchema>;

export const ApprovalCreateRequestSchema = z.strictObject({
  items: z
    .array(ApprovalItemSchema)
    .min(1)
    .max(APPROVAL_CAPS.items)
    .refine(
      (items) =>
        new Set(items.map((i) => `${i.kind}:${i.id}`)).size === items.length,
      "Each item may appear once.",
    ),
  reason: z.string().trim().min(1).max(APPROVAL_CAPS.reason),
});
export type ApprovalCreateRequest = z.infer<typeof ApprovalCreateRequestSchema>;

/** One item as the person sees it: what it is now, pinned to the state that was shown. */
export interface ApprovalItem {
  kind: ApprovalItemKind;
  id: string;
  title: string;
  /** Goal: draft/approved/cancelled. Entry: its trust level. */
  state: string;
  /** True when the item changed since the request was made: approving would be refused. */
  changed: boolean;
}

export interface ApprovalRequest {
  id: string;
  workspace_id: string;
  status: ApprovalStatus;
  reason: string;
  requested_by: string;
  items: ApprovalItem[];
  /** The page the person opens to answer: `/a/<id>` on sky-brain's own origin. */
  path: string;
  created_at: string;
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
}

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export const PushSubscribeRequestSchema = z.strictObject({
  endpoint: z.url({ protocol: /^https$/ }).max(1024),
  keys: z.strictObject({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
  expirationTime: z.number().nullable().optional(),
});
export type PushSubscribeRequest = z.infer<typeof PushSubscribeRequestSchema>;

export const PushUnsubscribeRequestSchema = z.strictObject({
  endpoint: z.string().min(1).max(1024),
});

/** What a push carries: no item text, so a lock screen shows nothing private. */
export interface ApprovalPush {
  title: string;
  body: string;
  /** `/a/<id>` on sky-brain's own origin. */
  path: string;
  approval_id: string;
  items: number;
}
