// Comments beside the document, like Pathly's comments panel: select text in the document and
// write a note on it in a color, or a note on the whole text; resolve and reopen; delete. The
// comments are saved in sky-brain, so the model reads them with the document (MCP `get`).
import { Alert, Button } from "panel-frame-ui";
import { useState, type RefObject } from "react";
import {
  api,
  type CommentColor,
  type EntryComment,
} from "../api.ts";
import { ago } from "../board/GoalTile.tsx";
import { passageIn } from "./highlight.ts";

const COLORS: CommentColor[] = ["yellow", "green", "blue", "purple", "orange"];
const BODY_MAX = 2000;
export const QUOTE_MAX = 500;

export function CommentsPanel(props: {
  entryId: string;
  text: string;
  comments: EntryComment[];
  meId: string;
  quote: string | null;
  activeId: string | null;
  onClearQuote: () => void;
  onActive: (id: string | null) => void;
  onComments: (next: EntryComment[]) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [body, setBody] = useState("");
  const [color, setColor] = useState<CommentColor>("yellow");
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (work: () => Promise<EntryComment[]>, after?: () => void) => {
    setBusy(true);
    setError(null);
    work().then(
      (next) => {
        setBusy(false);
        props.onComments(next);
        after?.();
      },
      (e: Error) => {
        setBusy(false);
        setError(e.message);
      },
    );
  };

  const add = () =>
    run(
      async () => [
        ...props.comments,
        await api.addComment(props.entryId, {
          body: body.trim(),
          color,
          ...(props.quote ? { quote: props.quote } : {}),
        }),
      ],
      () => {
        setBody("");
        props.onClearQuote();
      },
    );
  const resolve = (c: EntryComment) =>
    run(async () => {
      const done = await api.resolveComment(props.entryId, c.id, !c.resolved);
      return props.comments.map((x) => (x.id === done.id ? done : x));
    });
  const remove = (c: EntryComment) =>
    run(async () => {
      await api.deleteComment(props.entryId, c.id);
      return props.comments.filter((x) => x.id !== c.id);
    });

  const open = props.comments.filter((c) => !c.resolved);
  const shown = showResolved ? props.comments : open;
  return (
    <aside className="comments" aria-label="Comments">
      <div className="comments-head">
        <h2>Comments {open.length > 0 && <span className="count">{open.length}</span>}</h2>
        {props.comments.length > open.length && (
          <button
            type="button"
            className="link-button"
            onClick={() => setShowResolved(!showResolved)}
          >
            {showResolved ? "Hide resolved" : `Show resolved (${props.comments.length - open.length})`}
          </button>
        )}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add();
        }}
      >
        {props.quote ? (
          <div className={`quote c-${color}`}>
            <span>“{props.quote}”</span>
            <button type="button" className="x" aria-label="Comment on the whole document instead" onClick={props.onClearQuote}>
              ✕
            </button>
          </div>
        ) : (
          <p className="muted small">Select text in the document to comment on it, or write a note on the whole document.</p>
        )}
        <textarea
          ref={props.composerRef}
          className="pf-input"
          rows={3}
          maxLength={BODY_MAX}
          placeholder="Write a comment"
          aria-label="Comment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && body.trim()) {
              e.preventDefault();
              add();
            }
          }}
        />
        <div className="composer-row">
          <span className="swatches" role="radiogroup" aria-label="Color">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                title={c}
                className={`swatch c-${c}`}
                onClick={() => setColor(c)}
              />
            ))}
          </span>
          <Button type="submit" disabled={busy || !body.trim()}>
            Comment
          </Button>
        </div>
      </form>
      {error && <Alert tone="error">{error}</Alert>}
      <ul className="comment-list">
        {shown.map((c) => (
          <li
            key={c.id}
            className={`comment c-${c.color}`}
            data-active={props.activeId === c.id || undefined}
            data-resolved={c.resolved || undefined}
          >
            {c.quote && (
              <button type="button" className="comment-quote" title="Show in the document" onClick={() => props.onActive(props.activeId === c.id ? null : c.id)}>
                “{c.quote}”
              </button>
            )}
            {c.quote && !passageIn(props.text, c.quote) && (
              <span className="muted small">This passage has changed since.</span>
            )}
            <p className="comment-body">{c.body}</p>
            <span className="comment-meta">
              {c.author === props.meId ? "You" : c.author} · {ago(c.created_at, new Date())}
              {c.resolved && " · resolved"}
            </span>
            <span className="comment-acts">
              <button type="button" className="link-button" disabled={busy} onClick={() => resolve(c)}>
                {c.resolved ? "Reopen" : "Resolve"}
              </button>
              <button type="button" className="link-button danger" disabled={busy} onClick={() => remove(c)}>
                Delete
              </button>
            </span>
          </li>
        ))}
        {shown.length === 0 && <li className="muted small">No open comments.</li>}
      </ul>
    </aside>
  );
}
