// One task of a goal as the goal dialog shows it: number, title, state, what it waits on, where it
// works, and the person-only Release for a held text. Used by the list and by the diagram.
import { Alert, Badge, Button } from "panel-frame-ui";
import { api, type Task, type TaskStatus } from "../api.ts";

export const STEP_LABEL: Record<TaskStatus, string> = {
  pending: "waiting",
  in_progress: "running",
  done: "done",
  failed: "failed",
  blocked: "blocked",
};

export function Step(props: {
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
