// One goal opened as a dialog over the board: what it is for, its documents, its tasks in order,
// and the person-only actions: approve, release a held text, reject (cancel).
import { Alert, Badge, Button, Dialog } from "panel-frame-ui";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Goal,
  type GoalDocument,
  type Task,
  type TaskStatus,
} from "../api.ts";
import { canReject, isHeld } from "./columns.ts";
import { DocList } from "./DocList.tsx";
import { ago, proposer, stateBadge } from "./GoalTile.tsx";

const STEP_LABEL: Record<TaskStatus, string> = {
  pending: "waiting",
  in_progress: "running",
  done: "done",
  failed: "failed",
  blocked: "blocked",
};

export function GoalPanel(props: {
  goal: Goal;
  now: Date;
  onClose: () => void;
  onChanged: () => void;
  onReject: (goals: Goal[]) => void;
  onOpenDoc: (entryId: string) => void;
}) {
  const { goal } = props;
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [docs, setDocs] = useState<GoalDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(() => {
    api.goal(goal.id).then(
      (r) => {
        setTasks(r.tasks);
        setDocs(r.documents);
      },
      (e: Error) => setError(e.message),
    );
  }, [goal.id]);
  // The board polls; a fresh goal object means its tasks may have moved too.
  useEffect(loadTasks, [loadTasks, goal]);

  const act = (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    run().then(
      () => {
        setBusy(false);
        props.onChanged();
        loadTasks();
      },
      (e: Error) => {
        setBusy(false);
        setError(e.message);
      },
    );
  };

  const held = isHeld(goal);
  const unpinned = tasks?.some((t) => !t.pinned) ?? false;
  const canApprove =
    !held &&
    (goal.status === "draft" || (goal.status === "approved" && unpinned));
  const state = stateBadge(goal);

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={goal.title}
      className="goal-dialog"
      showCloseButton
      closeButtonLabel="Close"
    >
      <p className="note">
        <Badge tone={state.tone}>{state.label}</Badge>{" "}
        {goal.author_kind === "agent"
          ? `Proposed by ${proposer(goal)}`
          : "Added by you"}{" "}
        · {ago(goal.created_at, props.now)}
      </p>
      {held && (
        <Alert tone="warning">
          Held because it looks like {goal.quarantined_because}. Read it before
          releasing.
        </Alert>
      )}
      {goal.body && <p className="body">{goal.body}</p>}
      <DocList
        docs={docs}
        busy={busy}
        onOpen={props.onOpenDoc}
        onRemove={(entryId) => act(() => api.detachDocument(goal.id, entryId))}
      />
      {tasks === null ? (
        <p className="muted small">Loading tasks…</p>
      ) : tasks.length === 0 ? (
        <p className="muted small">No tasks yet.</p>
      ) : (
        <ol className="steps">
          {tasks.map((t, i) => (
            <Step
              key={t.id}
              task={t}
              index={i}
              all={tasks}
              busy={busy}
              act={act}
            />
          ))}
        </ol>
      )}
      {goal.status === "approved" && unpinned && (
        <Alert tone="warning">
          Some tasks changed or were added after approval. They wait until you
          approve again.
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="acts">
        {canApprove && (
          <Button
            disabled={busy}
            onClick={() => act(() => api.goalAction(goal.id, "approve"))}
          >
            Approve
          </Button>
        )}
        {held && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => act(() => api.goalAction(goal.id, "release"))}
          >
            Release
          </Button>
        )}
        {goal.status !== "cancelled" && (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => props.onReject([goal])}
          >
            {canReject(goal) ? "Reject" : "Cancel goal"}
          </Button>
        )}
      </div>
      {goal.status === "draft" && (
        <p className="note">
          Approving lets your devices run these tasks. Agents can propose, never
          approve.
        </p>
      )}
    </Dialog>
  );
}

function Step(props: {
  task: Task;
  index: number;
  all: Task[];
  busy: boolean;
  act: (run: () => Promise<unknown>) => void;
}) {
  const { task } = props;
  const deps = task.depends_on
    .map((id) => props.all.findIndex((t) => t.id === id))
    .filter((i) => i >= 0)
    .map((i) => `#${i + 1}`);
  const where =
    task.files === null
      ? "any file"
      : task.files.length > 0
        ? task.files.join(", ")
        : "no files";
  const detail = [
    deps.length > 0 ? `after ${deps.join(", ")}` : null,
    where,
    task.attempts > 0
      ? `attempt ${task.attempts} of ${task.max_attempts}`
      : null,
    task.holder ? `held by ${task.holder.actor}` : null,
  ].filter(Boolean);
  return (
    <li className={`step ${task.status}`}>
      <span className="num">
        {task.status === "done" ? "✓" : String(props.index + 1)}
      </span>
      <div>
        <div className="st">
          {task.title}
          {task.status !== "done" && <Badge>{STEP_LABEL[task.status]}</Badge>}
          {!task.pinned && <Badge tone="warning">not approved</Badge>}
        </div>
        {task.body && <p className="body small">{task.body}</p>}
        <div className="sm">{detail.join(" · ")}</div>
        {task.fail_reason && <Alert tone="error">{task.fail_reason}</Alert>}
        {task.quarantined_because && (
          <Alert tone="warning" className="row">
            <span>Held: {task.quarantined_because}.</span>
            <Button
              variant="secondary"
              className="small-button"
              disabled={props.busy}
              onClick={() => props.act(() => api.releaseTaskText(task.id))}
            >
              Release
            </Button>
          </Alert>
        )}
      </div>
    </li>
  );
}
