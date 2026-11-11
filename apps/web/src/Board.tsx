// One project's goals: newest first, each with its task counts; open one to see its tasks and
// approve, cancel or release it. Only a person can do those, so they live here, not in MCP.
import { useCallback, useEffect, useState } from "react";
import { FormFooter } from "./FormFooter.tsx";
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
          <button className="button" onClick={() => setAdding(true)}>
            New goal
          </button>
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
      {error && <p className="error">{error}</p>}
      {goals === null ? (
        <p className="muted">Loading goals…</p>
      ) : goals.length === 0 ? (
        <section className="card center">
          <p className="muted">
            No goals yet. Ask Claude to propose one with the sky-brain
            connector, or add one here.
          </p>
        </section>
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
        <span key={s} className={`pill status-${s}`}>
          {counts[s]} {STATUS_LABEL[s]}
        </span>
      ))}
    </span>
  );
}

function GoalCard({ goal, onChanged }: { goal: Goal; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <li className={`card goal goal-${goal.status}`}>
      <button
        className="goal-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="goal-title">
          <span className={`badge badge-${held ? "held" : goal.status}`}>
            {held ? "held" : goal.status}
          </span>
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
            <p className="warn">
              Held because it looks like {goal.quarantined_because}. Read it
              before releasing.
            </p>
          )}
          <p className="body">{goal.body}</p>
          {tasks === null ? (
            <p className="muted">Loading tasks…</p>
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
            <p className="warn small">
              Some tasks changed or were added after approval. They wait until
              you approve again.
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="row">
            {canApprove && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => act(() => api.goalAction(goal.id, "approve"))}
              >
                Approve
              </button>
            )}
            {held && (
              <button
                className="button"
                disabled={busy}
                onClick={() => act(() => api.goalAction(goal.id, "release"))}
              >
                Release
              </button>
            )}
            {goal.status !== "cancelled" && (
              <button
                className="button danger"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Cancel "${goal.title}"?`)) {
                    act(() => api.goalAction(goal.id, "cancel"));
                  }
                }}
              >
                Cancel goal
              </button>
            )}
          </div>
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
        <span className={`pill status-${task.status}`}>
          {STATUS_LABEL[task.status]}
        </span>
        <span className="task-title">{task.title}</span>
        {!task.pinned && <span className="pill">not approved</span>}
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
      {task.fail_reason && <p className="error small">{task.fail_reason}</p>}
      {task.quarantined_because && (
        <p className="warn small">
          Held: {task.quarantined_because}.{" "}
          <button
            className="link"
            disabled={props.busy}
            onClick={() => props.act(() => api.releaseTaskText(task.id))}
          >
            Release
          </button>
        </p>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        api.createGoal(props.projectId, title, body).then(
          () => props.onDone(true),
          (err: Error) => {
            setError(err.message);
            setBusy(false);
          },
        );
      }}
    >
      <label>
        <span className="muted">Title</span>
        <input
          autoFocus
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        <span className="muted">What done looks like</span>
        <textarea
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
