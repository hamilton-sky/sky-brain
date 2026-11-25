import { describe, expect, it } from "vitest";
import { insertLink, toggleInline, toggleLine } from "./format.ts";
import { COALESCE_MS, record, redo, start, undo } from "./history.ts";
import { passageIn, squash } from "./highlight.ts";
import {
  addSection,
  duplicateSection,
  joinSections,
  mergeWithNext,
  moveSection,
  splitSection,
  splitSections,
} from "./sections.ts";

describe("format", () => {
  it("toggles bold around a selection and back", () => {
    const on = toggleInline("bold", "make it loud", 8, 12);
    expect(on.text).toBe("make it **loud**");
    expect(on.text.slice(on.selStart, on.selEnd)).toBe("loud");
    const off = toggleInline("bold", on.text, on.selStart, on.selEnd);
    expect(off.text).toBe("make it loud");
  });
  it("inserts a placeholder with no selection", () => {
    const e = toggleInline("strike", "x ", 2, 2);
    expect(e.text).toBe("x ~~struck text~~");
  });
  it("sets heading sizes and replaces another marker", () => {
    expect(toggleLine("h2", "Title\nbody", 0, 0).text).toBe("## Title\nbody");
    expect(toggleLine("h1", "## Title", 3, 3).text).toBe("# Title");
    expect(toggleLine("h1", "# Title", 3, 3).text).toBe("Title");
  });
  it("numbers an ordered list over several lines", () => {
    const text = "a\nb\nc";
    expect(toggleLine("ol", text, 0, text.length).text).toBe("1. a\n2. b\n3. c");
    expect(toggleLine("ul", "1. a\n2. b", 0, 9).text).toBe("- a\n- b");
  });
  it("wraps a link and selects its address", () => {
    const e = insertLink("see docs", 4, 8);
    expect(e.text).toBe("see [docs](https://)");
    expect(e.text.slice(e.selStart, e.selEnd)).toBe("https://");
  });
});

describe("sections", () => {
  const md = "Intro line.\n\n## Steps\n\n1. one\n\n```\n## not a heading\n```\n\n## Why\n\nBecause.\n";
  it("splits at headings outside code fences and joins back", () => {
    const s = splitSections(md);
    expect(s.map((x) => x.heading)).toEqual(["", "## Steps", "## Why"]);
    expect(s[1]!.body).toContain("## not a heading");
    expect(joinSections(s)).toBe(md);
  });
  it("moves, duplicates, adds, splits and merges", () => {
    const s = splitSections(md);
    expect(moveSection(s, 2, 0).map((x) => x.heading)).toEqual(["## Why", "", "## Steps"]);
    expect(duplicateSection(s, 2)).toHaveLength(4);
    expect(addSection(s, 0)[1]!.heading).toBe("## New section");
    const split = splitSection(s, 0, 5, "## Rest");
    expect(split[0]!.body).toBe("Intro");
    expect(split[1]).toMatchObject({ heading: "## Rest", body: "line." });
    const merged = mergeWithNext(s, 1);
    expect(merged).toHaveLength(2);
    expect(merged[1]!.body).toContain("## Why\n\nBecause.");
  });
});

describe("history", () => {
  it("folds quick typing into one step, keeps actions apart, and undoes and redoes", () => {
    let h = start("a");
    h = record(h, "ab", 1000, true);
    h = record(h, "abc", 1300, true);
    expect(h.past).toEqual(["a"]);
    h = record(h, "abcd", 1300 + COALESCE_MS + 1, true);
    expect(h.past).toEqual(["a", "abc"]);
    h = record(h, "# abcd", 5000, false);
    h = record(h, "# abcde", 5001, true);
    expect(h.past).toEqual(["a", "abc", "abcd", "# abcd"]);
    h = undo(h);
    expect(h.present).toBe("# abcd");
    h = undo(undo(h));
    expect(h.present).toBe("abc");
    h = redo(h);
    expect(h.present).toBe("abcd");
    h = record(h, "x", 9000, false);
    expect(h.future).toEqual([]);
    expect(undo(start("z"))).toEqual(start("z"));
  });
});

describe("passages", () => {
  it("matches across markdown marks and whitespace", () => {
    expect(squash("**Merge** the  _Inbox_\nnightly.")).toBe("MergetheInboxnightly.");
    expect(passageIn("# Plan\n\nMerge the **Inbox** nightly.", "the Inbox night")).toBe(true);
    expect(passageIn("Merge weekly.", "nightly")).toBe(false);
  });
});
