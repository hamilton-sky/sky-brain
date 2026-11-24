// Finding a comment's passage in the rendered document and marking it, with the CSS Custom
// Highlight API (no change to the DOM, so the markdown renderer stays text only). Matching
// ignores whitespace and markdown marks, so a passage selected in the source still finds its
// rendered text. Browsers without the API simply show no marks.
import type { CommentColor } from "../api.ts";

const SKIP = /[\s*_`~#>]/;

/** The passage as the matcher compares it: no whitespace, no markdown marks. */
export const squash = (text: string): string =>
  Array.from(text)
    .filter((c) => !SKIP.test(c))
    .join("");

/** Whether the passage is still in the text (it may have been edited away). */
export const passageIn = (text: string, quote: string): boolean =>
  squash(text).includes(squash(quote));

export function findRange(root: HTMLElement, quote: string): Range | null {
  const want = squash(quote);
  if (!want) return null;
  const chars: [Text, number][] = [];
  let flat = "";
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const node = n as Text;
    const data = node.data;
    for (let i = 0; i < data.length; i += 1) {
      if (SKIP.test(data[i]!)) continue;
      chars.push([node, i]);
      flat += data[i];
    }
  }
  const at = flat.indexOf(want);
  if (at < 0) return null;
  const [startNode, startOffset] = chars[at]!;
  const [endNode, endOffset] = chars[at + want.length - 1]!;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset + 1);
  return range;
}

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS;
const NAMES = ["yellow", "green", "blue", "purple", "orange", "active"];

/** Marks each open comment's passage in its color, and the chosen one more strongly. */
export function markPassages(
  root: HTMLElement | null,
  comments: { id: string; quote: string | null; color: CommentColor }[],
  activeId: string | null,
): void {
  if (!supported()) return;
  for (const name of NAMES) CSS.highlights.delete(`sb-${name}`);
  if (!root) return;
  const groups = new Map<string, Range[]>();
  for (const c of comments) {
    if (!c.quote) continue;
    const range = findRange(root, c.quote);
    if (!range) continue;
    const name = c.id === activeId ? "active" : c.color;
    groups.set(name, [...(groups.get(name) ?? []), range]);
  }
  for (const [name, ranges] of groups) {
    CSS.highlights.set(`sb-${name}`, new Highlight(...ranges));
  }
}

export function clearPassages(): void {
  if (!supported()) return;
  for (const name of NAMES) CSS.highlights.delete(`sb-${name}`);
}
