// One goal opened as a dialog over the board: what it is for, its documents, its tasks in order,
// and the person-only actions: approve, release a held text, reject (cancel).
import { Alert, Badge, Button, Dialog } from "panel-frame-ui";
import { useCallback, useEffect, useState } from "react";
import { api, type Goal, type GoalDocument, type Task } from "../api.ts";
import { ViewSwitch } from "../ViewSwitch.tsx";
import { canReject, isHeld } from "./columns.ts";
import { DocList } from "./DocList.tsx";
import { ago, proposer, stateBadge } from "./GoalTile.tsx";
import { Step } from "./Step.tsx";
import { TaskGraph } from "./TaskGraph.tsx";

const TASKS_VIEW_KEY = "sky-brain.tasks-view";
type TasksView = "list" | "diagram";

function rememberedTasksView(): TasksView {
  try {
    return localStorage.getItem(TASKS_VIEW_KEY) === "diagram"
      ? "diagram"
      : "list";
  } catch {
    return "list";
  }
}

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
  const [tasksView, setTasksView] = useState<TasksView>(rememberedTasksView);
  const pickTasksView = (v: TasksView) => {
    setTasksView(v);
    try {
      localStorage.setItem(TASKS_VIEW_KEY, v);
    } catch {
      // Private windows may refuse storage; the view still switches.
    }
  };

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
      className={`goal-dialog${tasksView === "diagram" ? " wide" : ""}`}
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
        <>
          <ViewSwitch
            label="Tasks"
            value={tasksView}
            onChange={pickTasksView}
            views={[
              ["list", `Tasks (${tasks.length})`],
              ["diagram", "Diagram"],
            ]}
          />
          {tasksView === "diagram" ? (
            <TaskGraph
              tasks={tasks}
              renderTask={(t, i) => (
                <ol className="steps">
                  <Step task={t} index={i} all={tasks} busy={busy} act={act} />
                </ol>
              )}
            />
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
        </>
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
