# 5. The board: goals and tasks

## How the board works

A **project** holds **goals**. A goal holds **tasks**, which may depend on each other. The board
is the brain's working memory: what is being done now.

- A goal you propose is a **draft**. None of its tasks can be taken until the **person approves
  the goal**. Only goals the person approved ever run.
- `next_task` returns a task whose goal is approved, whose text is what the person approved, and
  whose dependencies are done.
- `claim_task` gives you a **10-minute lease** and a `claim_seq`. Keep the `claim_seq`. Renew
  before 10 minutes pass if you are still working. A lease that runs out sends the task back to
  ready, and a late report is refused.
- End every claim with `report_task` (done or failed) or `release_task` (give it back without
  counting an attempt). Never leave a claim to expire on purpose.
- `done` needs **proof**: gates you ran, a commit, a PR URL, or a summary of what changed.

## Planning a goal

Write the goal's `body` as "what done looks like", in plain words. Split it into tasks that each
fit in one sitting. Use `depends_on` (index of an earlier task in the same call, or an existing
task id) for order, and `files` for the paths a task touches, so two tasks on the same files
never run at once.

## Tools in this chapter (generated)

**list_projects** · read-only · `workspace_id?` → projects with ids.
**list_goals** · read-only · `project_id` → goals, newest first, with status and task counts.
**get_goal** · read-only · `goal_id` → one goal with all its tasks and dependencies.
**propose_goal** · writes · `project_id`, `title`, `body`; `executor?` (single, loop, team),
`feature_id?` → a draft goal.
**add_tasks** · writes · `goal_id`, `tasks[]` (title, body, `depends_on?`, `files?`, `lane?`,
`max_attempts?`) → the new tasks. On an approved goal, new tasks wait for approval.
**attach_document** · writes · `goal_id`, `entry_id` → attaches a captured document to the goal's
card. Capture it first; its summary is what the card shows.
**next_task** · read-only · `project_id`, `goal_id?` → `task` or `null`.
**claim_task** · writes · `task_id` → the task, `claim_seq`, lease end, and the context packet.
**renew_task** · writes · `task_id`, `claim_seq` → 10 more minutes.
**release_task** · writes · `task_id`, `claim_seq` → back to ready, no attempt counted.
**report_task** · writes · `task_id`, `claim_seq`, `outcome`; `proof` if done, `reason` if
failed; `lessons?` (≤3, done only).

## Recipe: do the next ready task

1. `next_task { project_id }`. If `task: null`, tell the person nothing is ready and stop.
2. `claim_task { task_id }`. Keep `claim_seq`. Read the context packet.
3. Work. Every ~8 minutes: `renew_task { task_id, claim_seq }`.
4. `report_task { outcome: "done", proof, lessons? }`, or `outcome: "failed", reason`.
   If you must stop without finishing: `release_task`.

## Recipe: plan a goal

1. `list_projects`, pick the project.
2. `list_goals { project_id }`: is there a goal for this already?
3. `propose_goal { project_id, title, body }`.
4. `add_tasks { goal_id, tasks }`.
5. `request_approval { items: [{ kind: "goal", id: goal_id }], reason }` and give the person the
   link.
