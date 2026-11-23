import { describe, expect, it } from "vitest";
import { AUTHOR_KINDS, ROLES } from "./enums.ts";
import {
  KNOWLEDGE_KINDS,
  MEMORY_LAYERS,
  TRUST_LEVELS,
  fallbackSummary,
} from "./memory.ts";

describe("enums match the spec's value lists", () => {
  it("AUTHOR_KINDS", () => {
    expect(AUTHOR_KINDS).toEqual(["human", "agent"]);
  });

  it("ROLES", () => {
    expect(ROLES).toEqual(["owner", "editor", "viewer"]);
  });

  it("memory layers, kinds and trust levels (D22, MEMORY-SCHEMA.md)", () => {
    expect(MEMORY_LAYERS).toEqual(["core", "long", "short", "working"]);
    expect(KNOWLEDGE_KINDS).toEqual([
      "fact",
      "decision",
      "hypothesis",
      "observation",
      "external",
    ]);
    expect(TRUST_LEVELS).toEqual([
      "quarantined",
      "proposed",
      "approved",
      "rejected",
    ]);
  });
});

describe("fallbackSummary", () => {
  it("is the title and the body's start, cut at a sentence, at most 600 characters", () => {
    const body = "First sentence here. ".repeat(60);
    const s = fallbackSummary("Title", body);
    expect(s.startsWith("Title: First sentence here.")).toBe(true);
    expect(s.endsWith(".")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(600);
  });

  it("keeps a short body whole", () => {
    expect(fallbackSummary("T", "  one\nline  ")).toBe("T: one line");
  });
});
