// The task board (cloud-task-board spec.md Interfaces): the enums, the strict request schemas
// and size caps of § Routes and § Size caps, and the wire `Goal`, `Task` and `Proof`.
// `Verb` lives in ./run-tokens.ts.
import { z } from "zod";
import type { AuthorKind } from "./enums.ts";
import { IdSchema } from "./scope.ts";

export const GOAL_EXECUTORS = ["single", "loop", "team"] as const;
export type GoalExecutor = (typeof GOAL_EXECUTORS)[number];

export const GOAL_STATUSES = ["draft", "approved", "cancelled"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const TASK_STATUSES = [
  "pending",
  "in_progress",
  "done",
  "failed",
  "blocked",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_EVENT_KINDS = [
  "created",
  "claimed",
  "renewed",
  "released",
  "done",
  "failed",
  "reclaimed",
] as const;
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

/** spec.md § Size caps. Over a cap is 413 `too_large` with `field` (see `tooLargeField`). */
export const TASK_CAPS = {
  title: 200,
  bodyBytes: 16_384,
  files: 100,
  filePath: 512,
  contextRefs: 50,
  contextRef: 2_048,
  tasks: 50,
  reason: 4_000,
  gates: 50,
  gateName: 200,
  summary: 4_000,
  prUrl: 2_048,
} as const;

export const MAX_ATTEMPTS_MIN = 1;
export const MAX_ATTEMPTS_MAX = 10;
export const READY_LIMIT_DEFAULT = 20;
export const READY_LIMIT_MAX = 100;

/** Marks an issue as a size cap, for the custom checks zod has no `too_big` for. */
const TOO_LARGE = { too_large: true };

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

const title = z.string().min(1).max(TASK_CAPS.title);
const body = z.string().refine((s) => utf8Bytes(s) <= TASK_CAPS.bodyBytes, {
  message: `At most ${TASK_CAPS.bodyBytes} UTF-8 bytes.`,
  params: TOO_LARGE,
});
const files = z
  .array(z.string().min(1).max(TASK_CAPS.filePath))
  .max(TASK_CAPS.files);
const contextRefs = z
  .array(z.string().min(1).max(TASK_CAPS.contextRef))
  .max(TASK_CAPS.contextRefs);
const claimSeq = z.int().min(1);

/**
 * The dotted path of the first over-cap value in a failed parse (`tasks.3.body`), or null when
 * the failure is not a size cap (then the answer is 400 `invalid_request`). A number over its
 * range (`limit`, `max_attempts`) is a bad request, not a size cap.
 */
export function tooLargeField(error: z.ZodError): string | null {
  for (const issue of error.issues) {
    const over =
      (issue.code === "too_big" &&
        (issue.origin === "string" || issue.origin === "array")) ||
      (issue.code === "custom" && issue.params?.too_large === true);
    if (over) return issue.path.map(String).join(".");
  }
  return null;
}

/** `POST /api/v1/goals`. The author, status and approver come from the server. */
export const GoalCreateRequestSchema = z.strictObject({
  project_id: IdSchema,
  feature_id: IdSchema.optional(),
  title,
  body,
  executor: z.enum(GOAL_EXECUTORS),
  assignee: z.string().min(1).optional(),
});
export type GoalCreateRequest = z.infer<typeof GoalCreateRequestSchema>;

/** `GET /api/v1/goals?project_id=`. */
export const GoalsListQuerySchema = z.strictObject({ project_id: IdSchema });

/**
 * One task of `POST /api/v1/goals/:id/tasks`. A `depends_on` entry is the 0-based index of an
 * earlier task in the same request or the id of a task already in the goal; the route checks
 * which (ticket 05). `files: null` means the task touches everything.
 */
export const TaskInputSchema = z.strictObject({
  title,
  body,
  lane: z.string().min(1).optional(),
  files: files.nullable().optional(),
  context_refs: contextRefs.optional(),
  depends_on: z.array(z.union([z.int().min(0), IdSchema])).optional(),
  max_attempts: z.int().min(MAX_ATTEMPTS_MIN).max(MAX_ATTEMPTS_MAX).optional(),
});
export type TaskInput = z.infer<typeof TaskInputSchema>;

export const TasksAddRequestSchema = z.strictObject({
  tasks: z.array(TaskInputSchema).min(1).max(TASK_CAPS.tasks),
});
export type TasksAddRequest = z.infer<typeof TasksAddRequestSchema>;

/** `GET /api/v1/tasks/ready`. A run token may leave out `project_id`. */
export const ReadyQuerySchema = z.strictObject({
  project_id: IdSchema.optional(),
  goal_id: IdSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(READY_LIMIT_MAX)
    .default(READY_LIMIT_DEFAULT),
});
export type ReadyQuery = z.infer<typeof ReadyQuerySchema>;

/** `POST /api/v1/tasks/:id/claim`: no fields; the holder comes from the token. */
export const ClaimRequestSchema = z.strictObject({});

/** `POST /api/v1/tasks/:id/renew` and `/release`. */
export const LeaseRequestSchema = z.strictObject({ claim_seq: claimSeq });
export type LeaseRequest = z.infer<typeof LeaseRequestSchema>;

export const ProofSchema = z.strictObject({
  gates: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(TASK_CAPS.gateName),
        ok: z.boolean(),
        summary: z.string().max(TASK_CAPS.summary).optional(),
      }),
    )
    .max(TASK_CAPS.gates)
    .optional(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/i)
    .optional(),
  pr_url: z
    .url({ protocol: /^https$/ })
    .max(TASK_CAPS.prUrl)
    .optional(),
  summary: z.string().max(TASK_CAPS.summary).optional(),
});
export type Proof = z.infer<typeof ProofSchema>;

/** `POST /api/v1/tasks/:id/done`. */
export const DoneRequestSchema = z.strictObject({
  claim_seq: claimSeq,
  proof: ProofSchema,
});
export type DoneRequest = z.infer<typeof DoneRequestSchema>;

/** `POST /api/v1/tasks/:id/fail`. */
export const FailRequestSchema = z.strictObject({
  claim_seq: claimSeq,
  reason: z.string().min(1).max(TASK_CAPS.reason),
});
export type FailRequest = z.infer<typeof FailRequestSchema>;

export interface Goal {
  id: string;
  workspace_id: string;
  project_id: string;
  feature_id: string | null;
  title: string;
  body: string;
  executor: GoalExecutor;
  status: GoalStatus;
  assignee: string | null;
  approved_by: string | null;
  approved_at: string | null;
  quarantined_because: string | null;
  author_kind: AuthorKind;
  author: string;
  on_behalf_of: string;
  /** Tasks by effective status. */
  counts: Record<TaskStatus, number>;
  created_at: string;
  updated_at: string;
}

export interface TaskHolder {
  actor: string;
  device_id: string | null;
  lease_expires_at: string;
}

export interface Task {
  id: string;
  goal_id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  body: string;
  lane: string | null;
  /** Null means the task touches everything. */
  files: string[] | null;
  context_refs: string[];
  depends_on: string[];
  /** Effective: an `in_progress` row whose lease has passed reads `pending`. */
  status: TaskStatus;
  /** Fails so far. */
  attempts: number;
  max_attempts: number;
  /** Set while in progress with a live lease, else null. */
  holder: TaskHolder | null;
  claim_seq: number;
  /** True when the text matches what was approved. */
  pinned: boolean;
  quarantined_because: string | null;
  proof: Proof | null;
  fail_reason: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}
