import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeTestDb,
  createTestDb,
  seedWorkspace,
} from "../testing/harness.ts";
import { writeAudit } from "./audit.ts";
import type { Db } from "./client.ts";
import { auditLog } from "./schema.ts";

let db: Db;
let workspaceId: string;

beforeAll(async () => {
  db = await createTestDb();
  workspaceId = (await seedWorkspace(db, { name: "audit" })).id;
  await writeAudit(db, {
    workspaceId,
    actor: "human:u1",
    action: "entry.create",
    targetId: null,
    details: { kind: "note", status: "approved" },
  });
}, 60_000);

afterAll(async () => {
  if (db) await closeTestDb(db);
}, 60_000);

async function rows() {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.workspaceId, workspaceId));
}

describe("audit_log", () => {
  it("writeAudit inserts one row", async () => {
    const before = (await rows()).length;
    await writeAudit(db, {
      workspaceId,
      actor: "agent:claude-code/builder",
      action: "entry.status",
      targetId: "00000000-0000-4000-8000-000000000001",
      details: {
        from: "proposed",
        to: "approved",
        via: "approve",
        on_behalf_of: "u1",
      },
    });
    const after = await rows();
    expect(after).toHaveLength(before + 1);
    const last = after.sort((a, b) => a.seq - b.seq).at(-1)!;
    expect(last).toMatchObject({
      workspaceId,
      actor: "agent:claude-code/builder",
      action: "entry.status",
      targetId: "00000000-0000-4000-8000-000000000001",
      details: {
        from: "proposed",
        to: "approved",
        via: "approve",
        on_behalf_of: "u1",
      },
    });
    expect(last.at).toBeInstanceOf(Date);
  });

  it("refuses an update to audit_log", async () => {
    const before = await rows();
    await expect(
      db
        .update(auditLog)
        .set({ action: "changed" })
        .where(eq(auditLog.workspaceId, workspaceId)),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only: UPDATE/) },
    });
    expect(await rows()).toEqual(before);
  });

  it("refuses a delete from audit_log", async () => {
    const before = await rows();
    await expect(
      db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId)),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only: DELETE/) },
    });
    expect(await rows()).toEqual(before);
  });

  it("refuses a truncate of audit_log", async () => {
    const before = await rows();
    await expect(
      db.execute(sql`truncate table audit_log`),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only: TRUNCATE/) },
    });
    expect(await rows()).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });
});
