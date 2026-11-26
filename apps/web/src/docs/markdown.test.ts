import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown.ts";

describe("parseMarkdown", () => {
  it("reads headings, lists, quotes, code and paragraphs", () => {
    const blocks = parseMarkdown(
      "# Plan\n\nMerge the **Inbox**\nnightly.\n\n- one\n- two\n\n1. first\n\n> note\n\n```ts\nconst a = 1;\n```\n\n---",
    );
    expect(blocks.map((b) => b.t)).toEqual([
      "h",
      "p",
      "ul",
      "ol",
      "quote",
      "code",
      "hr",
    ]);
    expect(blocks[1]).toEqual({
      t: "p",
      c: [
        { t: "text", v: "Merge the " },
        { t: "strong", c: [{ t: "text", v: "Inbox" }] },
        { t: "text", v: " nightly." },
      ],
    });
    expect(blocks[5]).toEqual({ t: "code", lang: "ts", v: "const a = 1;" });
  });

  it("reads a table, and a list item that wraps onto an indented line", () => {
    const blocks = parseMarkdown(
      "| id | Read it when |\n| --- | --- |\n| `board` | You plan **work** |\n\n- one\n  more\n- two",
    );
    expect(blocks[0]).toEqual({
      t: "table",
      head: [[{ t: "text", v: "id" }], [{ t: "text", v: "Read it when" }]],
      rows: [
        [
          [{ t: "code", v: "board" }],
          [
            { t: "text", v: "You plan " },
            { t: "strong", c: [{ t: "text", v: "work" }] },
          ],
        ],
      ],
    });
    expect(blocks[1]).toEqual({
      t: "ul",
      items: [[{ t: "text", v: "one more" }], [{ t: "text", v: "two" }]],
    });
    expect(parseMarkdown("a | b |")[0]!.t).toBe("p");
  });

  it("keeps raw HTML as text and drops unsafe link targets", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([
      { t: "text", v: "<img src=x onerror=alert(1)>" },
    ]);
    expect(parseInline("[click](javascript:steal)")).toEqual([
      { t: "text", v: "click" },
    ]);
    expect(parseInline("[site](https://example.com)")).toEqual([
      {
        t: "link",
        href: "https://example.com",
        c: [{ t: "text", v: "site" }],
      },
    ]);
  });
});
