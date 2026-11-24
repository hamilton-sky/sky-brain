import { describe, expect, it } from "vitest";
import type { Goal } from "../api.ts";
import { describeBulk, runBulk } from "./bulk.ts";
import {
  canBulkApprove,
  canReject,
  columnOf,
  digest,
  DIGEST_SIZE,
} from "./columns.ts";

const zero = { pending: 0, in_progress: 0, done: 0, failed: 0, blocked: 0 };
let n = 0;
function goal(over: Partial<Goal> = {}): Goal {
  n += 1;
  return {
    id: `g${n}`,
    project_id: "p",
    title: `Goal ${n}`,
    body: "",
    executor: "single",
    status: "approved",
    approved_by: null,
    quarantined_because: null,
    author_kind: "agent",
    author: "mcp/claude.ai/po",
    counts: { ...zero },
    created_at: "2026-11-24T08:00:00.000Z",
    ...over,
  };
}

describe("columnOf", () => {
  it("puts drafts and held goals in Needs you", () => {
    expect(columnOf(goal({ status: "draft" }))).toBe("needs");
    expect(columnOf(goal({ quarantined_because: "an instruction" }))).toBe(
      "needs",
    );
  });
  it("splits approved goals by how far their tasks got", () => {
    expect(columnOf(goal({ counts: { ...zero, pending: 2 } }))).toBe("wait");
    expect(columnOf(goal())).toBe("wait");
    expect(columnOf(goal({ counts: { ...zero, pending: 1, done: 1 } }))).toBe(
      "run",
    );
    expect(columnOf(goal({ counts: { ...zero, failed: 1 } }))).toBe("run");
    expect(columnOf(goal({ counts: { ...zero, done: 3 } }))).toBe("done");
  });
  it("drops cancelled goals", () => {
    expect(columnOf(goal({ status: "cancelled" }))).toBeNull();
  });
});

describe("bulk rules", () => {
  it("approves only drafts that are not held", () => {
    expect(canBulkApprove(goal({ status: "draft" }))).toBe(true);
    expect(
      canBulkApprove(goal({ status: "draft", quarantined_because: "x" })),
    ).toBe(false);
    expect(canBulkApprove(goal())).toBe(false);
  });
  it("rejects only goals waiting for you", () => {
    expect(canReject(goal({ status: "draft" }))).toBe(true);
    expect(canReject(goal({ counts: { ...zero, pending: 1 } }))).toBe(false);
  });
});

describe("digest", () => {
  it("shows the ten longest-waiting goals and counts the rest", () => {
    const waiting = Array.from({ length: DIGEST_SIZE + 3 }, (_, i) =>
      goal({
        status: "draft",
        created_at: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(),
      }),
    );
    const d = digest(
      [...waiting]
        .reverse()
        .concat(goal({ counts: { ...zero, done: 1, pending: 1, failed: 1 } })),
      new Date("2026-11-24T12:00:00.000Z"),
    );
    expect(d.cards).toHaveLength(DIGEST_SIZE);
    expect(d.cards[0]!.id).toBe(waiting[0]!.id);
    expect(d.more).toBe(3);
    expect(d.running).toBe(1);
    expect(d.withFailures).toBe(1);
  });
  it("counts agent proposals from the last day only", () => {
    const now = new Date("2026-11-24T12:00:00.000Z");
    const d = digest(
      [
        goal({ created_at: "2026-11-24T01:00:00.000Z" }),
        goal({ created_at: "2026-11-22T01:00:00.000Z" }),
        goal({ created_at: "2026-11-24T02:00:00.000Z", author_kind: "human" }),
      ],
      now,
    );
    expect(d.newToday).toBe(1);
  });
});

describe("runBulk", () => {
  it("keeps going past a refusal and names it", async () => {
    const a = goal({ title: "A" });
    const b = goal({ title: "B" });
    const c = goal({ title: "C" });
    const seen: string[] = [];
    const r = await runBulk([a, b, c], (id) => {
      seen.push(id);
      return id === b.id
        ? Promise.reject(new Error("It is held."))
        : Promise.resolve();
    });
    expect(seen).toEqual([a.id, b.id, c.id]);
    expect(r.done).toBe(2);
    expect(describeBulk("approve", r)).toBe(
      'Approved 2 goals. 1 could not be approved. "B": It is held.',
    );
  });
});
