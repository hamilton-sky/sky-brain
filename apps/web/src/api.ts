// The board's REST routes as the signed-in browser calls them: the session cookie only, and
// every write as JSON (the server refuses other bodies from a browser session).

export interface Me {
  kind: "human" | "agent";
  email: string;
  user_id: string;
  workspaces: { id: string; name: string; role: string }[];
}

export interface Project {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
}

export type TaskStatus =
  "pending" | "in_progress" | "done" | "failed" | "blocked";

export interface Goal {
  id: string;
  project_id: string;
  title: string;
  body: string;
  executor: string;
  status: "draft" | "approved" | "cancelled";
  approved_by: string | null;
  quarantined_because: string | null;
  author_kind: "human" | "agent";
  author: string;
  counts: Record<TaskStatus, number>;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  body: string;
  files: string[] | null;
  depends_on: string[];
  status: TaskStatus;
  attempts: number;
  max_attempts: number;
  holder: { actor: string; lease_expires_at: string } | null;
  pinned: boolean;
  quarantined_because: string | null;
  fail_reason: string | null;
  position: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers:
      method === "POST" ? { "content-type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const error = (parsed as { error?: { code?: string; message?: string } })
      ?.error;
    throw new ApiError(
      res.status,
      error?.code ?? "error",
      error?.message ?? `Request failed (${res.status}).`,
    );
  }
  return parsed as T;
}

export const api = {
  me: () => request<Me>("GET", "/api/v1/me"),
  projects: () =>
    request<{ projects: Project[] }>("GET", "/api/v1/projects").then(
      (r) => r.projects,
    ),
  createProject: (workspace_id: string, name: string) =>
    request<{ project: Project }>("POST", "/api/v1/projects", {
      workspace_id,
      name,
    }).then((r) => r.project),
  goals: (projectId: string) =>
    request<{ goals: Goal[] }>(
      "GET",
      `/api/v1/goals?project_id=${encodeURIComponent(projectId)}`,
    ).then((r) => r.goals),
  goal: (goalId: string) =>
    request<{ goal: Goal; tasks: Task[] }>("GET", `/api/v1/goals/${goalId}`),
  createGoal: (project_id: string, title: string, body: string) =>
    request<{ goal: Goal }>("POST", "/api/v1/goals", {
      project_id,
      title,
      body,
      executor: "single",
    }),
  goalAction: (goalId: string, action: "approve" | "cancel" | "release") =>
    request<{ goal: Goal }>("POST", `/api/v1/goals/${goalId}/${action}`),
  releaseTaskText: (taskId: string) =>
    request<unknown>("POST", `/api/v1/tasks/${taskId}/release-text`),
  signOut: () =>
    fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
};
