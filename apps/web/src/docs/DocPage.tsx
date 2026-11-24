// A document's own page (/docs/<id>), full width like the board: its title and summary, then
// the text in one of four views (Read, Sections, Source, Split), with comments beside it.
// Changes stay a draft with undo and redo until Save writes a new version (older versions are
// kept). A held document reads as plain text; a proposed one can be kept (approved) here.
import { Alert, Badge, Button, ConfirmDialog, Skeleton } from "panel-frame-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Entry, type EntryComment, type Me } from "../api.ts";
import { TRUST_BADGE } from "../board/DocList.tsx";
import { ago, signer } from "../board/GoalTile.tsx";
import { navigate } from "../router.ts";
import { CommentsPanel, QUOTE_MAX } from "./CommentsPanel.tsx";
import { clearPassages, findRange, markPassages } from "./highlight.ts";
import { record, redo, start, undo, type History } from "./history.ts";
import { Markdown } from "./Markdown.tsx";
import { MdTextarea } from "./MdTextarea.tsx";
import { SectionsView } from "./SectionsView.tsx";
import "./doc-page.css";
import "./editor.css";
import "./comments.css";

type View = "read" | "sections" | "source" | "split";
const VIEWS: [View, string][] = [
  ["read", "Read"],
  ["sections", "Sections"],
  ["source", "Source"],
  ["split", "Split"],
];
const VIEW_KEY = "sky-brain.doc-view";
const SUMMARY_MAX = 600;

function rememberedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return VIEWS.some(([id]) => id === v) ? (v as View) : "read";
  } catch {
    return "read";
  }
}

export function DocPage({ entryId, me }: { entryId: string; me: Me }) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [comments, setComments] = useState<EntryComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<History>(() => start(""));
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [view, setView] = useState<View>(rememberedView);
  const [quote, setQuote] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [floating, setFloating] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const readRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.entry(entryId).then(
      (r) => {
        setEntry(r.entry);
        setComments(r.comments);
        setHistory(start(r.entry.body));
        setTitle(r.entry.title);
        setSummary(r.entry.summary);
      },
      (e: Error) => setError(e.message),
    );
  }, [entryId]);
  useEffect(load, [load]);

  const text = history.present;
  const dirty =
    entry !== null &&
    (text !== entry.body || title !== entry.title || summary !== entry.summary);
  const canSave =
    dirty && !busy && !!title.trim() && !!text.trim() && !!summary.trim();
  const edit = (next: string, typing: boolean) =>
    setHistory((h) => record(h, next, Date.now(), typing));
  const onUndo = () => setHistory(undo);
  const onRedo = () => setHistory(redo);

  const save = () => {
    if (!entry || !canSave) return;
    setBusy(true);
    setError(null);
    api
      .reviseEntry(entry.id, { title: title.trim(), body: text, summary: summary.trim() })
      .then(
        (row) => {
          setBusy(false);
          setEntry(row);
          setTitle(row.title);
          setSummary(row.summary);
          setNotice(`Saved as version ${row.version}. Older versions are kept.`);
        },
        (e: Error) => {
          setBusy(false);
          setError(e.message);
        },
      );
  };
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  // Ctrl+S saves; leaving with unsaved changes asks first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Mark open comments' passages in the rendered text; scroll to the chosen one.
  useEffect(() => {
    if (view === "read" || view === "split") {
      markPassages(
        readRef.current,
        comments.filter((c) => !c.resolved),
        active,
      );
    } else clearPassages();
    return clearPassages;
  }, [comments, active, view, text]);
  useEffect(() => {
    const c = comments.find((x) => x.id === active);
    if (!c?.quote || !readRef.current) return;
    const range = findRange(readRef.current, c.quote);
    range?.startContainer.parentElement?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [active, comments]);

  const pickView = (v: View) => {
    setView(v);
    setFloating(null);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private windows may refuse storage.
    }
  };

  /** A selection in the rendered text becomes the passage to comment on. */
  const onReadMouseUp = () => {
    const sel = window.getSelection();
    const root = readRef.current;
    if (!sel || sel.isCollapsed || !root?.contains(sel.anchorNode)) {
      setFloating(null);
      return;
    }
    const picked = sel.toString().trim().slice(0, QUOTE_MAX);
    if (!picked) return;
    setQuote(picked);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setFloating({ x: rect.left + rect.width / 2, y: rect.bottom + 8 });
  };

  if (!entry) {
    return error ? (
      <Alert tone="error">{error}</Alert>
    ) : (
      <Skeleton className="loading" />
    );
  }
  const held = entry.trust === "quarantined";
  const trust = TRUST_BADGE[entry.trust];
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const editorProps = {
    onUndo,
    onRedo,
    onSelectText: (q: string) => setQuote(q.slice(0, QUOTE_MAX)),
  };
  const rendered = (
    <div
      ref={readRef}
      className="doc-rendered"
      onMouseUp={onReadMouseUp}
    >
      {held ? <pre className="doc-plain">{text}</pre> : <Markdown source={text} />}
    </div>
  );

  return (
    <div className="doc-page">
      <div className="doc-bar">
        <Button
          variant="quiet"
          onClick={() => (dirty ? setLeaving(true) : navigate({ page: "board" }))}
        >
          ← Board
        </Button>
        <span className="doc-meta">
          <Badge tone={trust.tone}>{trust.label}</Badge>
          <span>
            By {signer(entry.author_kind, entry.author)} · version {entry.version} ·{" "}
            {ago(entry.updated_at, new Date())}
          </span>
        </span>
        <span className="doc-bar-acts">
          <Button
            variant="secondary"
            className="icon-button"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={history.past.length === 0}
            onClick={onUndo}
          >
            ↶
          </Button>
          <Button
            variant="secondary"
            className="icon-button"
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            disabled={history.future.length === 0}
            onClick={onRedo}
          >
            ↷
          </Button>
          {entry.trust === "proposed" && !dirty && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                api.approveEntry(entry.id).then(
                  () => {
                    setBusy(false);
                    setNotice("Kept. Your agents can rely on it now.");
                    load();
                  },
                  (e: Error) => {
                    setBusy(false);
                    setError(e.message);
                  },
                );
              }}
            >
              Keep it
            </Button>
          )}
          <Button disabled={!canSave} onClick={save} title="Save (Ctrl+S)">
            {dirty ? `Save as version ${entry.version + 1}` : "Saved"}
          </Button>
        </span>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && !dirty && <Alert tone="success">{notice}</Alert>}
      {held && (
        <Alert tone="warning">
          Held because it looks like {entry.quarantined_because}. It shows as plain
          text; read it before trusting it.
        </Alert>
      )}
      <input
        className="doc-title-input"
        aria-label="Title"
        maxLength={200}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="doc-summary">
        <span className="doc-summary-label">Summary, shown on the card</span>
        <textarea
          rows={2}
          maxLength={SUMMARY_MAX}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>
      <div className="doc-modes">
        <div className="views" role="tablist" aria-label="Editor view">
          {VIEWS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              className="view"
              aria-selected={view === v}
              onClick={() => pickView(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="muted small">
          {words} words{dirty ? " · unsaved changes" : ""}
        </span>
      </div>
      <div className="doc-work">
        <div className={`doc-main view-${view}`}>
          {view === "read" && rendered}
          {view === "sections" && (
            <SectionsView text={text} onChange={edit} {...editorProps} />
          )}
          {view === "source" && (
            <MdTextarea
              label="Markdown source"
              className="tall"
              value={text}
              onChange={edit}
              {...editorProps}
            />
          )}
          {view === "split" && (
            <div className="split">
              <MdTextarea
                label="Markdown source"
                value={text}
                onChange={edit}
                {...editorProps}
              />
              {rendered}
            </div>
          )}
        </div>
        <CommentsPanel
          entryId={entry.id}
          text={text}
          comments={comments}
          meId={me.user_id}
          quote={quote}
          activeId={active}
          onClearQuote={() => setQuote(null)}
          onActive={setActive}
          onComments={setComments}
          composerRef={composer}
        />
      </div>
      {floating && (
        <button
          type="button"
          className="sel-comment pf-button pf-button-primary"
          style={{ left: floating.x, top: floating.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setFloating(null);
            composer.current?.focus();
          }}
        >
          Comment
        </button>
      )}
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Leave without saving?"
        description="Your changes to this document are not saved yet."
        confirmLabel="Leave"
        cancelLabel="Stay"
        confirmVariant="danger"
        onConfirm={() => navigate({ page: "board" })}
      />
    </div>
  );
}
