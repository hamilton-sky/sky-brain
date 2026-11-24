// A document as sections, the way Pathly's cell editor shows it: a new section starts at each
// heading (outside code fences); text before the first heading is a section with no heading.
// Pure list operations (move, duplicate, remove, add, split, merge) so they are tested
// (sections.test.ts); joinSections turns the list back into one markdown text.

export interface Section {
  id: string;
  /** The heading line as written ("## Steps"), or "" for text before the first heading. */
  heading: string;
  body: string;
}

let seq = 0;
const newId = (): string => `s${(seq += 1)}`;

const HEADING = /^#{1,6}\s+\S/;

export function splitSections(md: string): Section[] {
  const out: Section[] = [];
  let heading = "";
  let lines: string[] = [];
  let fence: string | null = null;
  const push = () => {
    const body = lines.join("\n").replace(/^\n+|\s+$/g, "");
    if (heading || body) out.push({ id: newId(), heading, body });
  };
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) fence = fence === null ? f[1]! : fence === f[1] ? null : fence;
    if (fence === null && !f && HEADING.test(line)) {
      push();
      heading = line.trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  push();
  return out;
}

export function joinSections(sections: Section[]): string {
  return (
    sections
      .map((s) => [s.heading, s.body].filter(Boolean).join("\n\n"))
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}

/** The heading's words without its `#` marks. */
export const headingText = (heading: string): string =>
  heading.replace(/^#{1,6}\s+/, "");

export function moveSection(list: Section[], from: number, to: number): Section[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!);
  return next;
}

export function duplicateSection(list: Section[], i: number): Section[] {
  const s = list[i];
  if (!s) return list;
  const next = [...list];
  next.splice(i + 1, 0, { ...s, id: newId() });
  return next;
}

export function removeSection(list: Section[], i: number): Section[] {
  return list.filter((_, j) => j !== i);
}

export function addSection(list: Section[], after: number, heading = "## New section"): Section[] {
  const next = [...list];
  next.splice(after + 1, 0, { id: newId(), heading, body: "" });
  return next;
}

/** Cuts section i's body at `offset`: the rest becomes a new section right after it. */
export function splitSection(
  list: Section[],
  i: number,
  offset: number,
  heading = "## New section",
): Section[] {
  const s = list[i];
  if (!s) return list;
  const next = [...list];
  next.splice(
    i,
    1,
    { ...s, body: s.body.slice(0, offset).trimEnd() },
    { id: newId(), heading, body: s.body.slice(offset).trimStart() },
  );
  return next;
}

/** Folds section i + 1 (its heading too) into the end of section i. */
export function mergeWithNext(list: Section[], i: number): Section[] {
  const a = list[i];
  const b = list[i + 1];
  if (!a || !b) return list;
  const body = [a.body, b.heading, b.body].filter(Boolean).join("\n\n");
  const next = [...list];
  next.splice(i, 2, { ...a, body });
  return next;
}
