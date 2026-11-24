// The formatting bar over every markdown editor: heading sizes, bold, italic, strikethrough,
// code, lists, quote and link, like Pathly's editor. Buttons keep the textarea's focus and
// selection (mouse down is prevented), then hand a transform to the editor.
import type { ReactNode } from "react";
import {
  insertLink,
  toggleInline,
  toggleLine,
  type Edit,
  type InlineFormat,
  type LineFormat,
} from "./format.ts";

export type Transform = (text: string, selStart: number, selEnd: number) => Edit;

interface Tool {
  key: string;
  label: string;
  icon: ReactNode;
  run: Transform;
}

const line = (f: LineFormat): Transform => (t, s, e) => toggleLine(f, t, s, e);
const inline =
  (f: InlineFormat): Transform =>
  (t, s, e) =>
    toggleInline(f, t, s, e);

const GROUPS: Tool[][] = [
  [
    { key: "h1", label: "Large heading", icon: "H1", run: line("h1") },
    { key: "h2", label: "Heading", icon: "H2", run: line("h2") },
    { key: "h3", label: "Small heading", icon: "H3", run: line("h3") },
  ],
  [
    { key: "b", label: "Bold (Ctrl+B)", icon: <b>B</b>, run: inline("bold") },
    { key: "i", label: "Italic (Ctrl+I)", icon: <i>I</i>, run: inline("italic") },
    { key: "s", label: "Strikethrough", icon: <s>S</s>, run: inline("strike") },
    { key: "c", label: "Code", icon: <code>{"</>"}</code>, run: inline("code") },
  ],
  [
    { key: "ul", label: "Bulleted list", icon: "•", run: line("ul") },
    { key: "ol", label: "Numbered list", icon: "1.", run: line("ol") },
    { key: "q", label: "Quote", icon: "❝", run: line("quote") },
    { key: "a", label: "Link (Ctrl+K)", icon: "🔗", run: insertLink },
  ],
];

/** Ctrl or Cmd + key → transform, for the editor's key handler. */
export const SHORTCUTS: Record<string, Transform> = {
  b: inline("bold"),
  i: inline("italic"),
  k: insertLink,
};

export function Toolbar(props: {
  onApply: (run: Transform) => void;
  children?: ReactNode;
}) {
  return (
    <div className="fmt-bar" role="toolbar" aria-label="Formatting">
      {GROUPS.map((group, g) => (
        <span key={g} className="fmt-group">
          {group.map((tool) => (
            <button
              key={tool.key}
              type="button"
              className={`fmt fmt-${tool.key}`}
              title={tool.label}
              aria-label={tool.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => props.onApply(tool.run)}
            >
              {tool.icon}
            </button>
          ))}
        </span>
      ))}
      {props.children}
    </div>
  );
}
