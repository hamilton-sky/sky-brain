// A goal as a card: its summary on hover, who proposed it, a task progress bar, its state, and (for goals waiting for
// you) a checkbox to pick it for a bulk approve or reject.
import { Badge } from "panel-frame-ui";
import type { Goal } from "../api.ts";
import { columnOf, isHeld, taskTotal } from "./columns.ts";

type Tone = "neutral" | "success" | "warning" | "danger" | "accent";

/** "po · claude.ai" for an agent signed `mcp/claude.ai/po`; "You" for a person. */
export function proposer(goal: Goal): string {
  if (goal.author_kind !== "agent") return "You";
  const parts = goal.author.split("/").filter(Boolean);
  const app = parts[1] ?? parts[0] ?? "agent";
  const role = parts.length > 2 ? parts[parts.length - 1] : null;
  return role ? `${role} · ${app}` : app;
}

/** The first ~280 characters of a goal's text, cut at a word, for the hover summary. */
export function summaryOf(body: string, max = 280): string {
  const text = body.trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function ago(iso: string, now: Date): string {
  const mins = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function stateBadge(goal: Goal): { tone: Tone; label: string } {
  if (isHeld(goal)) return { tone: "danger", label: "held" };
  if (goal.status === "draft")
    return { tone: "warning", label: "needs approval" };
  if (goal.status === "cancelled")
    return { tone: "neutral", label: "rejected" };
  return columnOf(goal) === "done"
    ? { tone: "success", label: "done" }
    : { tone: "success", label: "approved" };
}

export function ProgressBar({ counts }: { counts: Goal["counts"] }) {
  const total = taskTotal(counts);
  const parts: [number, string][] = [
    [counts.done, "d"],
    [counts.in_progress, "r"],
    [counts.failed, "f"],
    [counts.blocked, "b"],
  ];
  return (
    <span className="bar" aria-hidden="true">
      {total > 0 &&
        parts.map(([c, k]) =>
          c > 0 ? (
            <i
              key={k}
              className={k}
              style={{ width: `${(100 * c) / total}%` }}
            />
          ) : null,
        )}
    </span>
  );
}

export function Avatar({ goal }: { goal: Goal }) {
  const label = proposer(goal);
  return (
    <span className={goal.author_kind === "agent" ? "av" : "av person"}>
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function GoalTile(props: {
  goal: Goal;
  now: Date;
  open: boolean;
  onOpen: () => void;
  /** Present when the goal can be picked for a bulk action. */
  picked?: boolean;
  onPick?: (on: boolean) => void;
}) {
  const { goal } = props;
  const state = stateBadge(goal);
  const total = taskTotal(goal.counts);
  return (
    <div className="gc-wrap">
      {props.onPick && (
        <input
          type="checkbox"
          className="gc-check"
          aria-label={`Select "${goal.title}"`}
          checked={props.picked ?? false}
          onChange={(e) => props.onPick?.(e.target.checked)}
        />
      )}
      {goal.body && !isHeld(goal) && (
        <div className="gc-peek" role="tooltip" id={`peek-${goal.id}`}>
          {summaryOf(goal.body)}
        </div>
      )}
      <button
        type="button"
        aria-describedby={
          goal.body && !isHeld(goal) ? `peek-${goal.id}` : undefined
        }
        className={props.onPick ? "gc pickable" : "gc"}
        aria-pressed={props.open}
        onClick={props.onOpen}
      >
        <span className="t">{goal.title}</span>
        <span className="by">
          <Avatar goal={goal} />
          {proposer(goal)}
        </span>
        {isHeld(goal) && (
          <span className="why">
            Held: looks like {goal.quarantined_because}
          </span>
        )}
        <ProgressBar counts={goal.counts} />
        <span className="meta">
          <Badge tone={state.tone}>{state.label}</Badge>
          <Badge>
            {goal.counts.done}/{total} tasks
          </Badge>
          {goal.counts.failed > 0 && (
            <Badge tone="danger">{goal.counts.failed} failed</Badge>
          )}
          <span className="when">{ago(goal.created_at, props.now)}</span>
        </span>
      </button>
    </div>
  );
}
