// Package test for push.ts: runs against a migrated PGlite, without the app (PACKAGES.md).
// An alert goes only to the asking person's own subscriptions; a subscription the push service
// calls gone (404, 410) is removed, and push is off unless all three VAPID settings are set.
import type { ApprovalPush } from "@sky-brain/shared/approvals";
import type { Db } from "@sky-brain/db/client";
import { pushSubscriptions } from "@sky-brain/db/schema";
import { closeTestDb, createTestDb } from "@sky-brain/db/test-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPush, noPush, pushFromEnv, type PushTarget } from "./push.ts";

const message: ApprovalPush = {
  title: "Approval needed",
  body: "An agent asks for your approval.",
  path: "/a/00000000-0000-0000-0000-000000000000",
  approval_id: "00000000-0000-0000-0000-000000000000",
  items: 1,
};

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(pushSubscriptions).values([
    {
      userId: "ana",
      endpoint: "https://push.test/ana-phone",
      p256dh: "k",
      auth: "a",
    },
    {
      userId: "ana",
      endpoint: "https://push.test/ana-gone",
      p256dh: "k",
      auth: "a",
    },
    {
      userId: "ben",
      endpoint: "https://push.test/ben-phone",
      p256dh: "k",
      auth: "a",
    },
  ]);
});

afterAll(() => closeTestDb(db));

describe("push", () => {
  it("alerts only the person's own subscriptions and drops gone ones", async () => {
    const sent: PushTarget[] = [];
    const push = createPush("public-key", (target) => {
      sent.push(target);
      return Promise.resolve(target.endpoint.endsWith("-gone") ? 410 : 201);
    });
    await push.notify(db, "ana", message);

    expect(sent.map((t) => t.endpoint).sort()).toEqual([
      "https://push.test/ana-gone",
      "https://push.test/ana-phone",
    ]);
    const rows = await db.select().from(pushSubscriptions);
    expect(rows.map((r) => r.endpoint).sort()).toEqual([
      "https://push.test/ana-phone",
      "https://push.test/ben-phone",
    ]);
    const ana = rows.find((r) => r.userId === "ana")!;
    const ben = rows.find((r) => r.userId === "ben")!;
    expect(ana.lastSentAt).not.toBeNull();
    expect(ben.lastSentAt).toBeNull();
  });

  it("is off unless all three VAPID settings are set", () => {
    expect(pushFromEnv({})).toBe(noPush);
    expect(pushFromEnv({ VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "s" })).toBe(
      noPush,
    );
    expect(
      pushFromEnv({
        VAPID_PUBLIC_KEY: "p",
        VAPID_PRIVATE_KEY: "s",
        VAPID_SUBJECT: "mailto:test@example.com",
      }).publicKey,
    ).toBe("p");
  });
});
