import { describe, expect, it } from "vitest";
import { taskTextHash } from "./task-text.ts";

const base = {
  title: "Add the table",
  body: "Write the migration.",
  files: ["apps/server/src/db/tasks-schema.ts"],
  context_refs: ["entry:42"],
};

describe("taskTextHash", () => {
  it("is SHA-256 hex and the same for the same text", () => {
    const h = taskTextHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(taskTextHash({ ...base })).toBe(h);
  });

  it("changes with each of the four fields", () => {
    const h = taskTextHash(base);
    const changed = [
      { ...base, title: "Add the tables" },
      { ...base, body: "Write the migrations." },
      { ...base, files: ["apps/server/src/db/schema.ts"] },
      { ...base, context_refs: ["entry:43"] },
    ].map(taskTextHash);
    for (const c of changed) expect(c).not.toBe(h);
    expect(new Set(changed).size).toBe(changed.length);
  });

  it("tells null files from an empty list, and order matters", () => {
    const none = taskTextHash({ ...base, files: null });
    const empty = taskTextHash({ ...base, files: [] });
    expect(none).not.toBe(empty);
    expect(taskTextHash({ ...base, files: ["a", "b"] })).not.toBe(
      taskTextHash({ ...base, files: ["b", "a"] }),
    );
  });

  it("does not let text move between fields", () => {
    expect(taskTextHash({ ...base, title: "ab", body: "c" })).not.toBe(
      taskTextHash({ ...base, title: "a", body: "bc" }),
    );
    expect(
      taskTextHash({ ...base, files: ["a,b"], context_refs: [] }),
    ).not.toBe(taskTextHash({ ...base, files: ["a", "b"], context_refs: [] }));
  });
});
