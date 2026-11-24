// Today: a short digest of what changed, then at most ten goals waiting for you, the
// longest-waiting first, each approvable or rejectable in one tap, or all at once.
import { Badge, Button, EmptyState } from "panel-frame-ui";
import type { Goal } from "../api.ts";
import { BulkBar } from "./BulkBar.tsx";
import { canBulkApprove, digest, isHeld, taskTotal } from "./columns.ts";
import { ago, Avatar, ProgressBar, proposer } from "./GoalTile.tsx";

export function Digest(props: {
  goals: Goal[];
  now: Date;
  selected: ReadonlySet<string>;
  onSelect: (ids: Set<string>) => void;
  busy: boolean;
  openId: string | null;
  onOpen: (id: string) => void;
  onApprove: (goals: Goal[]) => void;
  onReject: (goals: Goal[]) => void;
}) {
  const d = digest(props.goals, props.now);
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  return (
    <section className="digest" aria-label="Today">
      <p className="digest-summary">
        <strong>
          {plural(d.cards.length + d.more, "goal waits", "goals wait")} for you.
        </strong>{" "}
        <span className="muted">
          {plural(d.newToday, "new proposal", "new proposals")} in the last day
          · {d.running} running
          {d.withFailures > 0 && (
            <>
              {" "}
              · {plural(d.withFailures, "goal has", "goals have")} failed tasks
            </>
          )}
        </span>
      </p>
      {d.cards.length === 0 ? (
        <EmptyState
          title="You're all caught up"
          description="When an agent proposes a goal, it waits here for your yes or no."
        />
      ) : (
        <>
          <BulkBar
            pool={d.cards}
            selected={props.selected}
            onSelect={props.onSelect}
            busy={props.busy}
            onApprove={props.onApprove}
            onReject={props.onReject}
          />
          <ol className="digest-list">
            {d.cards.map((g) => (
              <DigestCard key={g.id} {...props} goal={g} />
            ))}
          </ol>
          {d.more > 0 && (
            <p className="muted small">
              {plural(d.more, "more goal waits", "more goals wait")} after
              these. They show here as you clear the list, or under Needs you on
              the board.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function DigestCard(props: {
  goal: Goal;
  now: Date;
  selected: ReadonlySet<string>;
  onSelect: (ids: Set<string>) => void;
  busy: boolean;
  openId: string | null;
  onOpen: (id: string) => void;
  onApprove: (goals: Goal[]) => void;
  onReject: (goals: Goal[]) => void;
}) {
  const { goal } = props;
  const picked = props.selected.has(goal.id);
  const pick = (on: boolean) => {
    const next = new Set(props.selected);
    if (on) next.add(goal.id);
    else next.delete(goal.id);
    props.onSelect(next);
  };
  return (
    <li
      className={
        "dc" +
        (picked ? " picked" : "") +
        (props.openId === goal.id ? " open" : "")
      }
    >
      <input
        type="checkbox"
        className="dc-check"
        aria-label={`Select "${goal.title}"`}
        checked={picked}
        onChange={(e) => pick(e.target.checked)}
      />
      <div className="dc-main">
        <button
          type="button"
          className="dc-title"
          onClick={() => props.onOpen(goal.id)}
        >
          {goal.title}
        </button>
        <span className="by">
          <Avatar goal={goal} />
          {proposer(goal)} · {ago(goal.created_at, props.now)}
          <Badge>{tasksLabel(taskTotal(goal.counts))}</Badge>
        </span>
        {isHeld(goal) ? (
          <span className="why">
            Held: looks like {goal.quarantined_because}. Open it and read it
            before releasing.
          </span>
        ) : (
          goal.body && <p className="dc-body">{goal.body}</p>
        )}
        <ProgressBar counts={goal.counts} />
      </div>
      <div className="dc-acts">
        {canBulkApprove(goal) ? (
          <Button
            className="small-button"
            disabled={props.busy}
            onClick={() => props.onApprove([goal])}
          >
            Approve
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="small-button"
            onClick={() => props.onOpen(goal.id)}
          >
            Read
          </Button>
        )}
        <Button
          variant="danger"
          className="small-button"
          disabled={props.busy}
          onClick={() => props.onReject([goal])}
        >
          Reject
        </Button>
      </div>
    </li>
  );
}

function tasksLabel(tasks: number): string {
  return tasks === 1 ? "1 task" : `${tasks} tasks`;
}
