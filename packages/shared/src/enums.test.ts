import { describe, expect, it } from "vitest";
import { AUTHOR_KINDS, KINDS, ROLES, SOURCES, STATUSES } from "./enums.ts";

describe("enums match the spec's value lists", () => {
  it("KINDS", () => {
    expect(KINDS).toEqual([
      "rule",
      "decision",
      "claim",
      "question",
      "answer",
      "artifact",
      "lesson",
      "note",
    ]);
  });

  it("STATUSES", () => {
    expect(STATUSES).toEqual([
      "proposed",
      "approved",
      "open",
      "answered",
      "superseded",
      "expired",
      "rejected",
      "quarantined",
    ]);
  });

  it("SOURCES", () => {
    expect(SOURCES).toEqual(["human", "agent", "code", "web", "import"]);
  });

  it("AUTHOR_KINDS", () => {
    expect(AUTHOR_KINDS).toEqual(["human", "agent"]);
  });

  it("ROLES", () => {
    expect(ROLES).toEqual(["owner", "editor", "viewer"]);
  });
});
