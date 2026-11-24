// The documents attached to a goal, as the goal's dialog lists them: title, summary and trust;
// Open reads one full screen, Remove takes it off the goal (the document itself stays).
import { Badge, Button } from "panel-frame-ui";
import type { EntryTrust, GoalDocument } from "../api.ts";

type Tone = "neutral" | "success" | "warning" | "danger" | "accent";
export const TRUST_BADGE: Record<EntryTrust, { tone: Tone; label: string }> = {
  proposed: { tone: "warning", label: "proposed" },
  approved: { tone: "success", label: "kept" },
  rejected: { tone: "neutral", label: "rejected" },
  quarantined: { tone: "danger", label: "held" },
};

export const DOC_ICON = (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="doc-icon">
    <path d="M5.5 2.5h6l3.5 3.5v11a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-13.5a1 1 0 0 1 1-1z" />
    <path d="M11.5 2.5V6H15M7.5 10h5M7.5 13h5" />
  </svg>
);

export function DocList(props: {
  docs: GoalDocument[];
  busy: boolean;
  onOpen: (entryId: string) => void;
  onRemove: (entryId: string) => void;
}) {
  if (props.docs.length === 0) return null;
  return (
    <section className="docs" aria-label="Documents">
      <h3 className="docs-h">Documents</h3>
      <ul className="doc-list">
        {props.docs.map((d) => {
          const trust = TRUST_BADGE[d.trust];
          return (
            <li key={d.entry_id} className="doc">
              <button
                type="button"
                className="doc-open"
                onClick={() => props.onOpen(d.entry_id)}
              >
                {DOC_ICON}
                <span className="doc-title">{d.title}</span>
                <Badge tone={trust.tone}>{trust.label}</Badge>
              </button>
              <p className="doc-sum">
                {d.trust === "quarantined"
                  ? "Held: open it and read it before trusting it."
                  : d.summary}
              </p>
              <span className="doc-row">
                <Button
                  variant="secondary"
                  className="small-button"
                  onClick={() => props.onOpen(d.entry_id)}
                >
                  Open
                </Button>
                <Button
                  variant="secondary"
                  className="small-button"
                  disabled={props.busy}
                  onClick={() => props.onRemove(d.entry_id)}
                >
                  Remove
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
