// Web push for approval requests (D36): when an agent asks, every browser or phone the person
// turned notifications on in gets a short, generic alert linking to /a/<id>. The alert holds no
// item text (a lock screen shows it), and a failed push never fails the agent's request.
import type { ApprovalPush } from "@sky-brain/shared/approvals";
import { and, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import type { DbOrTx } from "@sky-brain/db/client";
import { pushSubscriptions } from "@sky-brain/db/schema";

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Sends one encrypted push; resolves with the push service's status code. */
export type PushSender = (
  target: PushTarget,
  payload: string,
) => Promise<number>;

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or `https:` contact the push services may use. */
  subject: string;
}

const SEND_TIMEOUT_MS = 4000;

/** The real sender: VAPID-signed, high urgency, kept by the push service for one hour. */
function webPushSender(vapid: VapidConfig): PushSender {
  return async (target, payload) => {
    try {
      const res = await webpush.sendNotification(target, payload, {
        vapidDetails: vapid,
        TTL: 3600,
        urgency: "high",
        timeout: SEND_TIMEOUT_MS,
      });
      return res.statusCode;
    } catch (err) {
      const status = (err as { statusCode?: unknown }).statusCode;
      return typeof status === "number" ? status : 0;
    }
  };
}

export interface Push {
  /** The VAPID public key browsers subscribe with, or null when push is off. */
  publicKey: string | null;
  notify(db: DbOrTx, userId: string, message: ApprovalPush): Promise<void>;
}

/** Push turned off: no key, nothing sent. */
export const noPush: Push = { publicKey: null, notify: async () => {} };

export function createPush(publicKey: string, send: PushSender): Push {
  return {
    publicKey,
    async notify(db, userId, message) {
      const subs = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId));
      if (subs.length === 0) return;
      const payload = JSON.stringify(message);
      const results = await Promise.all(
        subs.map(async (s) => ({
          id: s.id,
          status: await send(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          ).catch(() => 0),
        })),
      );
      // 404 and 410: the browser unsubscribed or the subscription expired.
      const gone = results
        .filter((r) => r.status === 404 || r.status === 410)
        .map((r) => r.id);
      if (gone.length > 0) {
        await db
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.userId, userId),
              inArray(pushSubscriptions.id, gone),
            ),
          );
      }
      const sent = results
        .filter((r) => r.status >= 200 && r.status < 300)
        .map((r) => r.id);
      if (sent.length > 0) {
        await db
          .update(pushSubscriptions)
          .set({ lastSentAt: new Date() })
          .where(inArray(pushSubscriptions.id, sent));
      }
    },
  };
}

/** Push from the environment: on only when all three VAPID settings are set. */
export function pushFromEnv(env: Record<string, string | undefined>): Push {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return noPush;
  return createPush(
    publicKey,
    webPushSender({ publicKey, privateKey, subject }),
  );
}
