// One project's goals: newest first, each with its task counts; open one to see its tasks and
// approve, cancel or release it. Only a person can do those, so they live here, not in MCP.
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  TextField,
} from "panel-frame-ui";
import { useCallback, useEffect, useState } from "react";
import { FormFooter, useFormSubmit } from "./FormFooter.tsx";
import {
  api,
  type Goal,
  type Project,
  type Task,
  type TaskStatus,
} from "./api.ts";

const REFRESH_MS = 15_000;
const STATUS_ORDER: TaskStatus[] = [
  "in_progress",
  "pending",
  "blocked",
  "failed",
  "done",
];
type Tone = "neutral" | "success" | "warning" | "danger" | "accent";
const STATUS_TONE: Record<TaskStatus, Tone> = {
  pending: "neutral",
  in_progress: "accent",
  done: "success",
  failed: "danger",
  blocked: "warning",
};
const GOAL_TONE: Record<string, Tone> = {
  draft: "warning",
  approved: "success",
  held: "danger",
};
const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "waiting",
  in_progress: "running",
  done: "done",
  failed: "failed",
  blocked: "blocked",
};

export function Board({ project }: { project: Project }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api.goals(project.id).then(
      (g) => {
        setGoals(g);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [project.id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <section>
      <div className="section-head">
        <h2>Goals</h2>
        {!adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            New goal
          </Button>
        )}
      </div>
      {adding && (
        <NewGoal
          projectId={project.id}
          onDone={(created) => {
            setAdding(false);
            if (created) load();
          }}
        />
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {goals === null ? (
        <Skeleton className="loading" />
      ) : goals.length === 0 ? (
        <EmptyState
          title="No goals yet"
          description="Ask Claude to propose one with the sky-brain connector, or add one here."
        />
      ) : (
        <ul className="goals">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} onChanged={load} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Counts({ counts }: { counts: Goal["counts"] }) {
  const parts = STATUS_ORDER.filter((s) => counts[s] > 0);
  if (parts.length === 0) return <span className="muted">no tasks</span>;
  return (
    <span className="counts">
      {parts.map((s) => (
        <Badge key={s} tone={STATUS_TONE[s]}>
          {counts[s]} {STATUS_LABEL[s]}
        </Badge>
      ))}
    </span>
  );
}

function GoalCard({ goal, onChanged }: { goal: Goal; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const loadTasks = useCallback(() => {
    api.goal(goal.id).then(
      (r) => setTasks(r.tasks),
      (e: Error) => setError(e.message),
    );
  }, [goal.id]);

  useEffect(() => {
    if (open) loadTasks();
  }, [open, loadTasks, goal]);

  const held = goal.quarantined_because !== null;
  const unpinned = tasks?.some((t) => !t.pinned) ?? false;
  const canApprove =
    !held &&
    (goal.status === "draft" || (goal.status === "approved" && unpinned));

  const act = (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    run().then(
      () => {
        setBusy(false);
        onChanged();
        loadTasks();
      },
      (e: Error) => {
        setBusy(false);
        setError(e.message);
      },
    );
  };

  return (
    <li className={`pf-card goal goal-${goal.status}`}>
      <button
        className="goal-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="goal-title">
          <Badge tone={GOAL_TONE[held ? "held" : goal.status] ?? "neutral"}>
            {held ? "held" : goal.status}
          </Badge>
          {goal.title}
        </span>
        <Counts counts={goal.counts} />
      </button>
      {open && (
        <div className="goal-body">
          <p className="muted small">
            Proposed by{" "}
            {goal.author_kind === "agent"
              ? `an agent (${goal.author})`
              : "a person"}{" "}
            · {new Date(goal.created_at).toLocaleString()}
          </p>
          {held && (
            <Alert tone="warning">
              Held because it looks like {goal.quarantined_because}. Read it
              before releasing.
            </Alert>
          )}
          <p className="body">{goal.body}</p>
          {tasks === null ? (
            <Skeleton className="loading" />
          ) : (
            <ol className="tasks">
              {tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  all={tasks}
                  busy={busy}
                  act={act}
                />
              ))}
            </ol>
          )}
          {goal.status === "approved" && unpinned && (
            <Alert tone="warning">
              Some tasks changed or were added after approval. They wait until
              you approve again.
            </Alert>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <div className="row">
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
                onClick={() => setConfirming(true)}
              >
                Cancel goal
              </Button>
            )}
          </div>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Cancel "${goal.title}"?`}
            description="Its tasks stop and agents will not pick them up again."
            confirmLabel="Cancel goal"
            cancelLabel="Keep it"
            onConfirm={() => {
              setConfirming(false);
              act(() => api.goalAction(goal.id, "cancel"));
            }}
          />
        </div>
      )}
    </li>
  );
}

function TaskRow(props: {
  task: Task;
  all: Task[];
  busy: boolean;
  act: (run: () => Promise<unknown>) => void;
}) {
  const { task } = props;
  const deps = task.depends_on
    .map((id) => props.all.findIndex((t) => t.id === id))
    .filter((i) => i >= 0)
    .map((i) => `#${i + 1}`);
  return (
    <li className="task">
      <div className="task-head">
        <Badge tone={STATUS_TONE[task.status]}>
          {STATUS_LABEL[task.status]}
        </Badge>
        <span className="task-title">{task.title}</span>
        {!task.pinned && <Badge tone="warning">not approved</Badge>}
      </div>
      <p className="body small">{task.body}</p>
      <p className="muted small">
        {deps.length > 0 && <>after {deps.join(", ")} · </>}
        {task.files === null
          ? "any file"
          : task.files.length > 0
            ? task.files.join(", ")
            : "no files"}
        {task.attempts > 0 && (
          <>
            {" "}
            · attempt {task.attempts} of {task.max_attempts}
          </>
        )}
        {task.holder && <> · held by {task.holder.actor}</>}
      </p>
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
    </li>
  );
}

function NewGoal(props: {
  projectId: string;
  onDone: (created: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const { busy, error, submit } = useFormSubmit();
  return (
    <form
      className="pf-card form"
      onSubmit={(e) =>
        submit(e, () =>
          api
            .createGoal(props.projectId, title, body)
            .then(() => props.onDone(true)),
        )
      }
    >
      <TextField
        label="Title"
        autoFocus
        required
        maxLength={200}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="pf-field">
        <span className="pf-field-label">What done looks like</span>
        <textarea
          className="pf-input"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <p className="muted small">
        It starts as a draft. Add tasks with Claude, then approve it here.
      </p>
      <FormFooter
        error={error}
        submitLabel="Create draft"
        disabled={busy || !title.trim()}
        onCancel={() => props.onDone(false)}
      />
    </form>
  );
}
