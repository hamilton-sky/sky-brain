// The document as sections, like Pathly's cell editor: each heading starts a card that can be
// read, edited (heading size and words, then the text with the formatting bar), moved up or
// down or dragged, duplicated, deleted, split at the cursor, or merged with the next one.
// Every change is written back as one markdown text, so the page's undo covers it.
import { Button, Select } from "panel-frame-ui";
import { useRef, useState, type DragEvent } from "react";
import { Markdown } from "./Markdown.tsx";
import { MdTextarea } from "./MdTextarea.tsx";
import {
  addSection,
  duplicateSection,
  headingText,
  joinSections,
  mergeWithNext,
  moveSection,
  removeSection,
  splitSection,
  splitSections,
  type Section,
} from "./sections.ts";

const LEVELS = [
  { value: "1", label: "H1 large" },
  { value: "2", label: "H2" },
  { value: "3", label: "H3" },
  { value: "4", label: "H4 small" },
];
const levelOf = (heading: string) =>
  String(Math.min(/^#+/.exec(heading)?.[0].length ?? 2, 4));

/** A blank heading still needs words, or it stops being a heading when read back. */
const emit = (list: Section[]) =>
  joinSections(
    list.map((s) =>
      s.heading && !headingText(s.heading).trim()
        ? { ...s, heading: `${s.heading.trim()} Untitled` }
        : s,
    ),
  );

export function SectionsView(props: {
  text: string;
  onChange: (text: string, typing: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectText: (quote: string) => void;
}) {
  const [sections, setSections] = useState(() => splitSections(props.text));
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(
    null,
  );
  // The text these sections were last read from or written to.
  const [synced, setSynced] = useState(props.text);
  const ta = useRef<HTMLTextAreaElement>(null);

  // Undo, redo or another view changed the text: read the sections from it again.
  if (props.text !== synced) {
    setSynced(props.text);
    setSections(splitSections(props.text));
  }

  const change = (next: Section[], typing = false) => {
    const text = emit(next);
    setSections(next);
    setSynced(text);
    props.onChange(text, typing);
  };
  const patch = (i: number, part: Partial<Section>, typing = true) =>
    change(
      sections.map((s, j) => (j === i ? { ...s, ...part } : s)),
      typing,
    );

  const onDrop = (e: DragEvent, to: number) => {
    e.preventDefault();
    if (drag) change(moveSection(sections, drag.from, to));
    setDrag(null);
  };

  const add = (after: number) => {
    const next = addSection(sections, after);
    change(next);
    setEditing(next[after + 1]!.id);
  };

  return (
    <div className="sections">
      {sections.length === 0 && (
        <Button variant="secondary" onClick={() => add(-1)}>
          Add a section
        </Button>
      )}
      {sections.map((s, i) => {
        const open = editing === s.id;
        const last = i === sections.length - 1;
        return (
          <div key={s.id} className="section-slot">
            <article
              className="section-card"
              data-open={open || undefined}
              data-over={drag?.over === i && drag.from !== i ? "" : undefined}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (drag.over !== i) setDrag({ ...drag, over: i });
              }}
              onDrop={(e) => onDrop(e, i)}
            >
              <header className="section-head-row">
                <span
                  className="grip"
                  draggable
                  title="Drag to move"
                  aria-hidden="true"
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", s.id);
                    setDrag({ from: i, over: i });
                  }}
                  onDragEnd={() => setDrag(null)}
                >
                  ⋮⋮
                </span>
                <span className="section-name">
                  {s.heading ? headingText(s.heading) : "Opening text"}
                </span>
                <span className="section-tools">
                  <Tool label={open ? "Done" : "Edit"} text={open ? "Done" : "Edit"} onClick={() => setEditing(open ? null : s.id)} />
                  <Tool label="Move up" text="↑" disabled={i === 0} onClick={() => change(moveSection(sections, i, i - 1))} />
                  <Tool label="Move down" text="↓" disabled={last} onClick={() => change(moveSection(sections, i, i + 1))} />
                  <Tool label="Duplicate" text="⧉" onClick={() => change(duplicateSection(sections, i))} />
                  <Tool label="Merge with the next section" text="⤓" disabled={last} onClick={() => change(mergeWithNext(sections, i))} />
                  <Tool label="Delete section" text="✕" onClick={() => change(removeSection(sections, i))} />
                </span>
              </header>
              {open ? (
                <div className="section-edit">
                  {s.heading && (
                    <div className="heading-row">
                      <Select
                        aria-label="Heading size"
                        variant="compact"
                        value={levelOf(s.heading)}
                        options={LEVELS}
                        onValueChange={(v) =>
                          patch(i, { heading: `${"#".repeat(Number(v))} ${headingText(s.heading)}` }, false)
                        }
                      />
                      <input
                        className="pf-input heading-input"
                        aria-label="Heading"
                        value={headingText(s.heading)}
                        onChange={(e) =>
                          patch(i, { heading: `${"#".repeat(Number(levelOf(s.heading)))} ${e.target.value}` })
                        }
                      />
                    </div>
                  )}
                  <MdTextarea
                    label={`Text of ${s.heading ? headingText(s.heading) : "the opening"}`}
                    value={s.body}
                    autoFocus
                    taRef={ta}
                    onChange={(body, typing) => patch(i, { body }, typing)}
                    onUndo={props.onUndo}
                    onRedo={props.onRedo}
                    onSelectText={props.onSelectText}
                    tools={
                      <button
                        type="button"
                        className="fmt fmt-wide"
                        title="Split this section at the cursor"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const at = ta.current?.selectionStart ?? s.body.length;
                          const next = splitSection(sections, i, at);
                          change(next);
                          setEditing(next[i + 1]!.id);
                        }}
                      >
                        Split here
                      </button>
                    }
                  />
                </div>
              ) : (
                <div
                  className="section-read"
                  onDoubleClick={() => setEditing(s.id)}
                >
                  <Markdown source={[s.heading, s.body].filter(Boolean).join("\n\n")} />
                </div>
              )}
            </article>
            <button
              type="button"
              className="add-section"
              onClick={() => add(i)}
            >
              + Add section
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Tool(props: {
  label: string;
  text: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="sec-tool"
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.text}
    </button>
  );
}
