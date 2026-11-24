// A markdown textarea with the formatting bar: toolbar buttons and Ctrl+B / I / K format the
// selection, Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) go to the page's undo history, and a
// selection is reported so the person can comment on it.
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { SHORTCUTS, Toolbar, type Transform } from "./Toolbar.tsx";

export interface MdTextareaProps {
  value: string;
  /** `typing` is true for keystrokes (folded into one undo step), false for a format action. */
  onChange: (text: string, typing: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectText?: (quote: string) => void;
  label: string;
  className?: string;
  autoFocus?: boolean;
  taRef?: RefObject<HTMLTextAreaElement | null>;
  /** More toolbar buttons (a section's Split here). */
  tools?: ReactNode;
}

export function MdTextarea(props: MdTextareaProps) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = props.taRef ?? own;
  const pending = useRef<[number, number] | null>(null);

  useLayoutEffect(() => {
    const sel = pending.current;
    const ta = ref.current;
    if (sel && ta) {
      pending.current = null;
      ta.focus();
      ta.setSelectionRange(sel[0], sel[1]);
    }
  }, [props.value, ref]);

  const apply = (run: Transform) => {
    const ta = ref.current;
    if (!ta) return;
    const r = run(ta.value, ta.selectionStart, ta.selectionEnd);
    pending.current = [r.selStart, r.selEnd];
    props.onChange(r.text, false);
  };

  return (
    <div className={`md-editor ${props.className ?? ""}`}>
      <Toolbar onApply={apply}>{props.tools}</Toolbar>
      <textarea
        ref={ref}
        className="pf-input md-source"
        aria-label={props.label}
        spellCheck
        autoFocus={props.autoFocus}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value, true)}
        onSelect={(e) => {
          const ta = e.currentTarget;
          const quote = ta.value.slice(ta.selectionStart, ta.selectionEnd);
          if (quote.trim()) props.onSelectText?.(quote.trim());
        }}
        onKeyDown={(e) => {
          if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
          const key = e.key.toLowerCase();
          if (key === "z" || key === "y") {
            e.preventDefault();
            if (key === "y" || e.shiftKey) props.onRedo();
            else props.onUndo();
            return;
          }
          const run = !e.shiftKey ? SHORTCUTS[key] : undefined;
          if (run) {
            e.preventDefault();
            apply(run);
          }
        }}
      />
    </div>
  );
}
