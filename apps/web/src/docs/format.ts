// Formatting a markdown source by selection: pure (text, selection) -> (text, selection), so the
// source editor and every section editor emit the same markdown and the rules are tested
// (format.test.ts). Inline marks toggle; line formats (heading sizes, lists, quote) toggle per
// line.

export interface Edit {
  text: string;
  selStart: number;
  selEnd: number;
}

export type InlineFormat = "bold" | "italic" | "strike" | "code";
export type LineFormat = "h1" | "h2" | "h3" | "ul" | "ol" | "quote";

const MARK: Record<InlineFormat, string> = {
  bold: "**",
  italic: "_",
  strike: "~~",
  code: "`",
};

const PLACEHOLDER: Record<InlineFormat, string> = {
  bold: "bold text",
  italic: "italic text",
  strike: "struck text",
  code: "code",
};

export function toggleInline(
  format: InlineFormat,
  text: string,
  selStart: number,
  selEnd: number,
): Edit {
  const mark = MARK[format];
  const before = text.slice(0, selStart);
  const selected = text.slice(selStart, selEnd);
  const after = text.slice(selEnd);
  if (before.endsWith(mark) && after.startsWith(mark)) {
    const start = selStart - mark.length;
    return {
      text: before.slice(0, start) + selected + after.slice(mark.length),
      selStart: start,
      selEnd: start + selected.length,
    };
  }
  if (
    selected.length >= mark.length * 2 &&
    selected.startsWith(mark) &&
    selected.endsWith(mark)
  ) {
    const inner = selected.slice(mark.length, selected.length - mark.length);
    return {
      text: before + inner + after,
      selStart,
      selEnd: selStart + inner.length,
    };
  }
  const inner = selected || PLACEHOLDER[format];
  const start = selStart + mark.length;
  return {
    text: before + mark + inner + mark + after,
    selStart: start,
    selEnd: start + inner.length,
  };
}

const LINE_PREFIX = /^(#{1,6}\s+|\s*[-*+]\s+|\s*\d+[.)]\s+|>\s?)/;

function prefixFor(format: LineFormat, n: number): string {
  switch (format) {
    case "h1":
      return "# ";
    case "h2":
      return "## ";
    case "h3":
      return "### ";
    case "ul":
      return "- ";
    case "ol":
      return `${n}. `;
    case "quote":
      return "> ";
  }
}

function hasFormat(format: LineFormat, line: string): boolean {
  switch (format) {
    case "h1":
      return /^#\s/.test(line);
    case "h2":
      return /^##\s/.test(line);
    case "h3":
      return /^###\s/.test(line);
    case "ul":
      return /^\s*[-*+]\s/.test(line);
    case "ol":
      return /^\s*\d+[.)]\s/.test(line);
    case "quote":
      return /^>/.test(line);
  }
}

/**
 * Applies a line format to every line the selection touches, replacing any heading, list or
 * quote marker already there; when every touched line already has it, removes it instead.
 */
export function toggleLine(
  format: LineFormat,
  text: string,
  selStart: number,
  selEnd: number,
): Edit {
  const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
  const endNl = text.indexOf("\n", Math.max(selEnd - 1, selStart));
  const lineEnd = endNl === -1 ? text.length : endNl;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const allHave = lines.every((l) => !l.trim() || hasFormat(format, l));
  let n = 0;
  const changed = lines.map((l) => {
    if (!l.trim() && lines.length > 1) return l;
    const bare = l.replace(LINE_PREFIX, "");
    if (allHave) return bare;
    n += 1;
    return prefixFor(format, n) + bare;
  });
  const block = changed.join("\n");
  return {
    text: text.slice(0, lineStart) + block + text.slice(lineEnd),
    selStart: lineStart,
    selEnd: lineStart + block.length,
  };
}

/** Wraps the selection as a link and selects the address to type over. */
export function insertLink(text: string, selStart: number, selEnd: number): Edit {
  const label = text.slice(selStart, selEnd) || "link text";
  const url = "https://";
  const inserted = `[${label}](${url})`;
  const urlStart = selStart + label.length + 3;
  return {
    text: text.slice(0, selStart) + inserted + text.slice(selEnd),
    selStart: urlStart,
    selEnd: urlStart + url.length,
  };
}
