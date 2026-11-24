// A small, safe markdown reader for documents agents attach: it parses into plain data that
// Markdown.tsx renders as React elements, so no HTML from a document ever reaches the page.
// Covers what agents write most: headings, paragraphs, lists, quotes, code, rules, and inline
// bold, italic, code and links (http, https and mailto only).

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "h"; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "quote"; c: Inline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "hr" };

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push({ t: "code", v: m[1]! });
    } else if (
      (m = /^\*\*(.+?)\*\*/.exec(rest)) ||
      (m = /^__(.+?)__/.exec(rest))
    ) {
      flush();
      out.push({ t: "strong", c: parseInline(m[1]!) });
    } else if (
      (m = /^\*(?!\s)(.+?)\*/.exec(rest)) ||
      (m = /^_(?!\s)(.+?)_(?![A-Za-z0-9])/.exec(rest))
    ) {
      flush();
      out.push({ t: "em", c: parseInline(m[1]!) });
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      flush();
      const href = m[2]!;
      if (SAFE_LINK.test(href)) {
        out.push({ t: "link", href, c: parseInline(m[1]!) });
      } else {
        out.push({ t: "text", v: m[1]! });
      }
    } else {
      buf += text[i];
      i += 1;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}

const LIST = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    let m: RegExpMatchArray | null;
    if (!line.trim()) {
      i += 1;
    } else if ((m = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line))) {
      const fence = m[1]!;
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence)) {
        code.push(lines[i]!);
        i += 1;
      }
      i += 1;
      blocks.push({ t: "code", lang: m[2] ?? "", v: code.join("\n") });
    } else if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      const level = Math.min(m[1]!.length, 4) as 1 | 2 | 3 | 4;
      blocks.push({ t: "h", level, c: parseInline(m[2]!) });
      i += 1;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ t: "hr" });
      i += 1;
    } else if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ t: "quote", c: parseInline(quote.join(" ")) });
    } else if ((m = LIST.exec(line))) {
      const ordered = /\d/.test(m[1]!);
      const items: Inline[][] = [];
      while (i < lines.length && (m = LIST.exec(lines[i]!))) {
        items.push(parseInline(m[2]!));
        i += 1;
      }
      blocks.push({ t: ordered ? "ol" : "ul", items });
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i]!.trim() &&
        !/^(#{1,6}\s|\s*```|\s*~~~|\s*>)/.test(lines[i]!) &&
        !LIST.test(lines[i]!)
      ) {
        para.push(lines[i]!.trim());
        i += 1;
      }
      blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    }
  }
  return blocks;
}
