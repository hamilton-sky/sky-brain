// The board's REST routes as the signed-in browser calls them: the session cookie only, and
// every write as JSON (the server refuses other bodies from a browser session).
import type { CommentColor, EntryComment } from "@sky-brain/shared/comments";
import type { Hat } from "@sky-brain/shared/hats";

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

/** A document attached to a goal: the summary only (read the body with `api.entry`). */
export interface GoalDocument {
  entry_id: string;
  kind: string;
  trust: EntryTrust;
  title: string;
  summary: string;
  version: number;
  author_kind: "human" | "agent";
  author: string;
  quarantined_because: string | null;
  updated_at: string;
  attached_by: string;
  attached_at: string;
}

export type EntryTrust = "proposed" | "approved" | "rejected" | "quarantined";

/** One memory entry with its body (markdown). */
export interface Entry {
  id: string;
  kind: string;
  trust: EntryTrust;
  title: string;
  body: string;
  summary: string;
  version: number;
  author_kind: "human" | "agent";
  author: string;
  quarantined_because: string | null;
  updated_at: string;
}

// Comments on a document: the shared wire types (types only, so nothing of zod reaches the page).
export type { CommentColor, EntryComment } from "@sky-brain/shared/comments";
export interface AgentProfile {
  id: string;
  slug: string;
  display_name: string;
  kind: "worker" | "steward";
}

export interface ConnectedApp {
  client_id: string;
  name: string | null;
  profile_id: string | null;
  hat_id: string | null;
}
export type { Hat } from "@sky-brain/shared/hats";

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
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    // Every write sends a JSON body, DELETE too: the server refuses a cookie write that is not
    // JSON (json_required), and an empty body has no content type at all.
    headers:
      method === "GET" ? undefined : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
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
    request<{ goals: Goal[]; documents: Record<string, GoalDocument[]> }>(
      "GET",
      `/api/v1/goals?project_id=${encodeURIComponent(projectId)}`,
    ),
  goal: (goalId: string) =>
    request<{ goal: Goal; tasks: Task[]; documents: GoalDocument[] }>(
      "GET",
      `/api/v1/goals/${goalId}`,
    ),
  detachDocument: (goalId: string, entryId: string) =>
    request<null>("DELETE", `/api/v1/goals/${goalId}/documents/${entryId}`),
  entry: (entryId: string) =>
    request<{ entry: Entry; comments: EntryComment[] }>(
      "GET",
      `/api/v1/entries/${entryId}`,
    ),
  addComment: (
    entryId: string,
    comment: { body: string; quote?: string; color: CommentColor },
  ) =>
    request<{ comment: EntryComment }>(
      "POST",
      `/api/v1/entries/${entryId}/comments`,
      comment,
    ).then((r) => r.comment),
  resolveComment: (entryId: string, commentId: string, resolved: boolean) =>
    request<{ comment: EntryComment }>(
      "POST",
      `/api/v1/entries/${entryId}/comments/${commentId}/resolve`,
      { resolved },
    ).then((r) => r.comment),
  deleteComment: (entryId: string, commentId: string) =>
    request<null>("DELETE", `/api/v1/entries/${entryId}/comments/${commentId}`),
  reviseEntry: (
    entryId: string,
    change: { title: string; body: string; summary: string },
  ) =>
    request<{ entry: Entry }>(
      "POST",
      `/api/v1/entries/${entryId}/versions`,
      change,
    ).then((r) => r.entry),
  approveEntry: (entryId: string) =>
    request<unknown>("POST", `/api/v1/entries/${entryId}/approve`),
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
  agents: () =>
    request<{ profiles: AgentProfile[]; apps: ConnectedApp[] }>(
      "GET",
      "/api/v1/agents",
    ),
  createAgentProfile: (
    slug: string,
    display_name: string,
    kind: AgentProfile["kind"],
  ) =>
    request<{ profile: AgentProfile }>("POST", "/api/v1/agents/profiles", {
      slug,
      display_name,
      kind,
    }),
  deleteAgentProfile: (id: string) =>
    request<null>("DELETE", `/api/v1/agents/profiles/${id}`),
  bindApp: (client_id: string, profile_id: string | null) =>
    request<unknown>("POST", "/api/v1/agents/bind", { client_id, profile_id }),
  hats: () =>
    request<{ hats: Hat[] }>("GET", "/api/v1/agents/hats").then((r) => r.hats),
  createHat: (slug: string, name: string, description: string) =>
    request<{ hat: Hat }>("POST", "/api/v1/agents/hats", {
      slug,
      name,
      description,
    }),
  deleteHat: (id: string) =>
    request<null>("DELETE", `/api/v1/agents/hats/${id}`),
  bindHat: (client_id: string, hat_id: string | null) =>
    request<unknown>("POST", "/api/v1/agents/hats/bind", { client_id, hat_id }),
  signOut: () =>
    fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
};

export interface ApprovalItem {
  kind: "goal" | "entry";
  id: string;
  title: string;
  state: string;
  changed: boolean;
  /** Entries: the memory it is in now. */
  memory_id: string | null;
  /** Entries: where the agent suggests keeping it. */
  save_to: string | null;
  outcome: "approved" | "rejected" | "skipped" | null;
  /** When kept in another memory: the new entry there. */
  saved_as: string | null;
}

/** A memory an approved entry can be kept in. */
export interface ApprovalTarget {
  id: string;
  name: string;
  layer: "core" | "long" | "short";
}

/** The person's choice for one item. */
export interface ItemDecision {
  id: string;
  action: "approve" | "reject" | "skip";
  save_to?: string;
}

export interface Approval {
  id: string;
  workspace_id: string;
  status: "pending" | "approved" | "rejected" | "expired" | "superseded";
  reason: string;
  requested_by: string;
  items: ApprovalItem[];
  targets: ApprovalTarget[];
  path: string;
  created_at: string;
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
}

export const approvalsApi = {
  pending: () =>
    request<{ approvals: Approval[] }>("GET", "/api/v1/approvals").then(
      (r) => r.approvals,
    ),
  get: (id: string) =>
    request<{ approval: Approval }>("GET", `/api/v1/approvals/${id}`).then(
      (r) => r.approval,
    ),
  /** Approve item by item (`items`), or reject the whole request. */
  decide: (id: string, action: "approve" | "reject", items?: ItemDecision[]) =>
    request<{ approval: Approval }>(
      "POST",
      `/api/v1/approvals/${encodeURIComponent(id)}/${action}`,
      items ? { items } : undefined,
    ).then((r) => r.approval),
};

export const pushApi = {
  key: () =>
    request<{ public_key: string | null }>("GET", "/api/v1/push/key").then(
      (r) => r.public_key,
    ),
  subscribe: (subscription: PushSubscriptionJSON) =>
    request<unknown>("POST", "/api/v1/push/subscribe", subscription),
  unsubscribe: (endpoint: string) =>
    request<unknown>("POST", "/api/v1/push/unsubscribe", { endpoint }),
};

/** An entry as a list or search returns it: no body, with where it lives and what it points to. */
export interface EntrySummary {
  id: string;
  memory_id: string;
  layer: "core" | "long" | "short";
  kind: string;
  trust: EntryTrust;
  title: string;
  summary: string;
  refs: string[];
  author_kind: "human" | "agent";
  author: string;
  created_at: string;
  updated_at: string;
}

export const entriesApi = {
  /** A layer's newest entries, or those matching `q` (the server's word search). */
  list: (layer: EntrySummary["layer"], q?: string, limit = 50) => {
    const params = new URLSearchParams({ layer, limit: String(limit) });
    if (q) params.set("q", q);
    return request<{ entries: EntrySummary[] }>(
      "GET",
      `/api/v1/entries?${params.toString()}`,
    ).then((r) => r.entries);
  },
};
