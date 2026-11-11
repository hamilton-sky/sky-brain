// Seeds and helpers for cloud-task-board tests (spec.md Interfaces -> How a test reaches the
// server). Tests only.
import { DEVICE_CODE_GRANT_TYPE } from "@sky-brain/shared/devices";
import type { AuthorKind } from "@sky-brain/shared/enums";
import type { Verb } from "@sky-brain/shared/run-tokens";
import type {
  GoalExecutor,
  GoalStatus,
  TaskStatus,
} from "@sky-brain/shared/tasks";
import { eq, sql } from "drizzle-orm";
import { goals, taskDeps, tasks } from "../db/schema.ts";
import { taskTextHash } from "../tasks/task-text.ts";
import {
  testClient,
  type Db,
  type TestClient,
  type TestServer,
} from "./harness.ts";

/** A client that sends `Authorization: Bearer <token>`. */
export function withToken(server: TestServer, token: string): TestClient {
  return testClient(server.url, token);
}

/** Code, approve, token: the device flow through its routes, as a client would. */
export async function loginDevice(
  server: TestServer,
  person: { kind: "human"; user_id: string },
  name: string,
): Promise<{ deviceId: string; deviceToken: string }> {
  const code = await server.anonymous.post("/api/device/code", {
    client_name: "test",
  });
  if (code.status !== 200) {
    throw new Error(`loginDevice: device code got ${code.status} ${code.text}`);
  }
  const approved = await server
    .as(person)
    .post("/api/v1/devices/approve", { user_code: code.body.user_code, name });
  if (approved.status !== 200) {
    throw new Error(
      `loginDevice: approve got ${approved.status} ${approved.text}`,
    );
  }
  const token = await server.anonymous.post("/api/device/token", {
    grant_type: DEVICE_CODE_GRANT_TYPE,
    device_code: code.body.device_code,
  });
  if (token.status !== 200) {
    throw new Error(`loginDevice: token got ${token.status} ${token.text}`);
  }
  return {
    deviceId: token.body.device_id,
    deviceToken: token.body.device_token,
  };
}

/** A run token minted through `POST /api/v1/run-tokens`, as a device would. */
export async function mintRunToken(
  server: TestServer,
  deviceToken: string,
  body: {
    project_id: string;
    verbs: Verb[];
    role?: "editor" | "viewer";
    ttl_seconds?: number;
  },
): Promise<{ runToken: string; expiresAt: string }> {
  const res = await withToken(server, deviceToken).post(
    "/api/v1/run-tokens",
    body,
  );
  if (res.status !== 201) {
    throw new Error(`mintRunToken: got ${res.status} ${res.text}`);
  }
  return { runToken: res.body.run_token, expiresAt: res.body.expires_at };
}

export interface SeedGoal {
  workspaceId: string;
  projectId: string;
  featureId?: string;
  /** Default `seed goal`. */
  title?: string;
  /** Default empty. */
  body?: string;
  /** Default `single`. */
  executor?: GoalExecutor;
  /** Default `draft`; `approved` also sets `approved_at`. */
  status?: GoalStatus;
  approvedBy?: string;
  assignee?: string;
  /** Default `human`. */
  authorKind?: AuthorKind;
  /** Default `seed-user`. */
  author?: string;
  /** Default: the author for a human, `seed-user` for an agent. */
  onBehalfOf?: string;
  quarantinedBecause?: string;
}

export async function seedGoal(
  db: Db,
  opts: SeedGoal,
): Promise<{ id: string }> {
  const authorKind = opts.authorKind ?? "human";
  const author = opts.author ?? "seed-user";
  const status = opts.status ?? "draft";
  const [row] = await db
    .insert(goals)
    .values({
      workspaceId: opts.workspaceId,
      projectId: opts.projectId,
      featureId: opts.featureId ?? null,
      title: opts.title ?? "seed goal",
      body: opts.body ?? "",
      executor: opts.executor ?? "single",
      status,
      assignee: opts.assignee ?? null,
      approvedBy: opts.approvedBy ?? null,
      approvedAt: status === "approved" ? new Date() : null,
      quarantinedBecause: opts.quarantinedBecause ?? null,
      authorKind,
      author,
      onBehalfOf:
        opts.onBehalfOf ?? (authorKind === "human" ? author : "seed-user"),
    })
    .returning({ id: goals.id });
  return row!;
}

export interface SeedTask {
  goalId: string;
  /** Default `seed task`. */
  title?: string;
  /** Default empty. */
  body?: string;
  lane?: string;
  /** Default null (touches everything). */
  files?: string[] | null;
  /** Ids of tasks this one waits for. */
  dependsOn?: string[];
  /** Default `pending`. */
  status?: TaskStatus;
  /** Default 3. */
  maxAttempts?: number;
  /** Writes `approved_hash` too. Default: true when the goal is approved. */
  pinned?: boolean;
  quarantinedBecause?: string;
}

/** A task at the end of its goal, with the goal's workspace, project and author. */
export async function seedTask(
  db: Db,
  opts: SeedTask,
): Promise<{ id: string }> {
  const [goal] = await db.select().from(goals).where(eq(goals.id, opts.goalId));
  if (!goal) throw new Error(`seedTask: no goal ${opts.goalId}`);
  const [last] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(eq(tasks.goalId, goal.id));
  const text = {
    title: opts.title ?? "seed task",
    body: opts.body ?? "",
    files: opts.files ?? null,
    context_refs: [],
  };
  const textHash = taskTextHash(text);
  const pinned = opts.pinned ?? goal.status === "approved";
  const [row] = await db
    .insert(tasks)
    .values({
      goalId: goal.id,
      workspaceId: goal.workspaceId,
      projectId: goal.projectId,
      title: text.title,
      body: text.body,
      lane: opts.lane ?? null,
      files: text.files,
      contextRefs: text.context_refs,
      status: opts.status ?? "pending",
      maxAttempts: opts.maxAttempts ?? 3,
      textHash,
      approvedHash: pinned ? textHash : null,
      quarantinedBecause: opts.quarantinedBecause ?? null,
      position: last!.n,
      authorKind: goal.authorKind,
      author: goal.author,
      onBehalfOf: goal.onBehalfOf,
    })
    .returning({ id: tasks.id });
  if (opts.dependsOn?.length) {
    await db
      .insert(taskDeps)
      .values(
        opts.dependsOn.map((dependsOnId) => ({ taskId: row!.id, dependsOnId })),
      );
  }
  return row!;
}
