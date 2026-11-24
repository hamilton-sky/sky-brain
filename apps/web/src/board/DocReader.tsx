// A document opened full screen: its summary, then the markdown, readable; Edit turns it into
// an editor and Save writes a new version (older versions are kept). A held document shows as
// plain text with a warning; a proposed one can be kept (approved) here.
import { Alert, Badge, Button, Dialog, TextField } from "panel-frame-ui";
import { useCallback, useEffect, useState } from "react";
import { api, type Entry } from "../api.ts";
import { TRUST_BADGE } from "./DocList.tsx";
import { signer } from "./GoalTile.tsx";
import { Markdown } from "./Markdown.tsx";
import "./docs.css";

const SUMMARY_MAX = 600;

export function DocReader(props: {
  entryId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "", summary: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.entry(props.entryId).then(setEntry, (e: Error) => setError(e.message));
  }, [props.entryId]);
  useEffect(load, [load]);

  const act = (run: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    run().then(
      () => {
        setBusy(false);
        after?.();
        load();
        props.onChanged();
      },
      (e: Error) => {
        setBusy(false);
        setError(e.message);
      },
    );
  };

  const held = entry?.trust === "quarantined";
  const trust = entry ? TRUST_BADGE[entry.trust] : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={entry?.title ?? "Document"}
      className="doc-reader"
      showCloseButton
      closeButtonLabel="Close"
    >
      {entry === null ? (
        error ? (
          <Alert tone="error">{error}</Alert>
        ) : (
          <p className="muted small">Loading…</p>
        )
      ) : editing ? (
        <form
          className="doc-edit"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () => api.reviseEntry(entry.id, draft),
              () => setEditing(false),
            );
          }}
        >
          <TextField
            label="Title"
            required
            maxLength={200}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <label className="pf-field">
            <span className="pf-field-label">
              Summary (shown on the card, {SUMMARY_MAX} characters at most)
            </span>
            <textarea
              className="pf-input"
              rows={3}
              maxLength={SUMMARY_MAX}
              value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            />
          </label>
          <label className="pf-field doc-body-field">
            <span className="pf-field-label">Text (markdown)</span>
            <textarea
              className="pf-input doc-source"
              spellCheck
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="row">
            <Button
              type="submit"
              disabled={busy || !draft.title.trim() || !draft.body.trim()}
            >
              Save as version {entry.version + 1}
            </Button>
            <Button
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="doc-read">
          <p className="note">
            {trust && <Badge tone={trust.tone}>{trust.label}</Badge>} By{" "}
            {signer(entry.author_kind, entry.author)} · version {entry.version}{" "}
            · {new Date(entry.updated_at).toLocaleString()}
          </p>
          {held && (
            <Alert tone="warning">
              Held because it looks like {entry.quarantined_because}. Shown as
              plain text; read it before trusting it.
            </Alert>
          )}
          <div className="doc-summary">
            <span className="doc-summary-label">Summary</span>
            {entry.summary}
          </div>
          {held ? (
            <pre className="doc-plain">{entry.body}</pre>
          ) : (
            <Markdown source={entry.body} />
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <div className="row doc-acts">
            <Button
              variant="secondary"
              onClick={() => {
                setDraft({
                  title: entry.title,
                  body: entry.body,
                  summary: entry.summary,
                });
                setEditing(true);
              }}
            >
              Edit
            </Button>
            {entry.trust === "proposed" && (
              <Button
                disabled={busy}
                onClick={() => act(() => api.approveEntry(entry.id))}
              >
                Keep it
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
