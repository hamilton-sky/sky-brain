// The board's MCP tools (list projects and goals, propose a goal, add tasks, take the next
// task, claim, renew, release and report). Each one is a thin call to the REST route through
// board-dispatch.ts, so the caller (an agent acting for the token's person) gets exactly the
// REST checks: an agent proposes drafts only and can never approve (CLAUDE.md hard rule 3).
import type { McpServer } from "@modelcontextprotocol/server";
import { IdSchema } from "@sky-brain/shared/scope";
import {
  GOAL_EXECUTORS,
  ProofSchema,
  TaskInputSchema,
  TASK_CAPS,
} from "@sky-brain/shared/tasks";
import { z } from "zod";
import type { BoardCall, BoardResponse } from "./board-dispatch.ts";

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** A 2xx answer as the tool's result; anything else as a tool error carrying the API error. */
function toToolResult(res: BoardResponse): ToolResult {
  const ok = res.status >= 200 && res.status < 300;
  const body =
    res.body !== null && typeof res.body === "object"
      ? (res.body as Record<string, unknown>)
      : {};
  if (ok) {
    return {
      content: [{ type: "text", text: JSON.stringify(body) }],
      structuredContent: body,
    };
  }
  const payload = { status: res.status, ...body };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: true,
  };
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, openWorldHint: false } as const;
const claimSeq = z
  .int()
  .min(1)
  .describe("The claim_seq that claim_task returned.");

export function registerBoardTools(server: McpServer, call: BoardCall): void {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "Lists the projects in the workspaces the signed-in person belongs to. Goals and " +
        "tasks live in a project; use a project's id with the other board tools.",
      inputSchema: z.object({ workspace_id: IdSchema.optional() }),
      annotations: READ,
    },
    async ({ workspace_id }) =>
      toToolResult(
        await call(
          "GET",
          `/projects${workspace_id ? `?workspace_id=${workspace_id}` : ""}`,
        ),
      ),
  );

  server.registerTool(
    "list_goals",
    {
      title: "List goals",
      description:
        "Lists a project's goals, newest first, with each goal's status (draft, approved, " +
        "cancelled) and its task counts by status.",
      inputSchema: z.object({ project_id: IdSchema }),
      annotations: READ,
    },
    async ({ project_id }) =>
      toToolResult(await call("GET", `/goals?project_id=${project_id}`)),
  );

  server.registerTool(
    "get_goal",
    {
      title: "Get a goal",
      description:
        "Returns one goal and all its tasks, with dependencies and status.",
      inputSchema: z.object({ goal_id: IdSchema }),
      annotations: READ,
    },
    async ({ goal_id }) => toToolResult(await call("GET", `/goals/${goal_id}`)),
  );

  server.registerTool(
    "propose_goal",
    {
      title: "Propose a goal",
      description:
        "Creates a goal as a draft. Only a person can approve it (on the sky-brain web page); " +
        "until then none of its tasks can be taken. Add tasks with add_tasks.",
      inputSchema: z.object({
        project_id: IdSchema,
        title: z.string().min(1).max(TASK_CAPS.title),
        body: z.string().describe("What done looks like, in plain words."),
        executor: z.enum(GOAL_EXECUTORS).default("single"),
        feature_id: IdSchema.optional(),
      }),
      annotations: WRITE,
    },
    async (args) => toToolResult(await call("POST", "/goals", args)),
  );

  server.registerTool(
    "add_tasks",
    {
      title: "Add tasks to a goal",
      description:
        "Adds tasks to a goal. A depends_on entry is the 0-based index of an earlier task in " +
        "this call, or the id of a task already in the goal. files lists the paths a task " +
        "touches (null: everything), so two tasks on the same files never run at once. Adding " +
        "a task to an approved goal leaves the new task waiting for a person's approval.",
      inputSchema: z.object({
        goal_id: IdSchema,
        tasks: z.array(TaskInputSchema).min(1).max(TASK_CAPS.tasks),
      }),
      annotations: WRITE,
    },
    async ({ goal_id, tasks }) =>
      toToolResult(await call("POST", `/goals/${goal_id}/tasks`, { tasks })),
  );

  server.registerTool(
    "next_task",
    {
      title: "Next ready task",
      description:
        "Returns the next task that may be taken now in a project (or one goal): its goal is " +
        "approved by the signed-in person, its text is what they approved, and every " +
        "dependency is done. Returns task: null when nothing is ready. Claim it with claim_task.",
      inputSchema: z.object({
        project_id: IdSchema,
        goal_id: IdSchema.optional(),
      }),
      annotations: READ,
    },
    async ({ project_id, goal_id }) => {
      const res = await call(
        "GET",
        `/tasks/ready?project_id=${project_id}&limit=1${goal_id ? `&goal_id=${goal_id}` : ""}`,
      );
      if (res.status !== 200) return toToolResult(res);
      const tasks = (res.body as { tasks: unknown[] }).tasks;
      return toToolResult({ status: 200, body: { task: tasks[0] ?? null } });
    },
  );

  server.registerTool(
    "claim_task",
    {
      title: "Claim a task",
      description:
        "Claims a ready task with a 10-minute lease. Keep the returned claim_seq: renew_task " +
        "extends the lease, and report_task or release_task end it. A task whose lease runs " +
        "out goes back to ready, and a late report is refused.",
      inputSchema: z.object({ task_id: IdSchema }),
      annotations: WRITE,
    },
    async ({ task_id }) =>
      toToolResult(await call("POST", `/tasks/${task_id}/claim`, {})),
  );

  server.registerTool(
    "renew_task",
    {
      title: "Renew a task's lease",
      description:
        "Extends the lease on a task you hold by another 10 minutes.",
      inputSchema: z.object({ task_id: IdSchema, claim_seq: claimSeq }),
      annotations: WRITE,
    },
    async ({ task_id, claim_seq }) =>
      toToolResult(
        await call("POST", `/tasks/${task_id}/renew`, { claim_seq }),
      ),
  );

  server.registerTool(
    "release_task",
    {
      title: "Release a task",
      description:
        "Gives a task you hold back to the ready list without counting an attempt.",
      inputSchema: z.object({ task_id: IdSchema, claim_seq: claimSeq }),
      annotations: WRITE,
    },
    async ({ task_id, claim_seq }) =>
      toToolResult(
        await call("POST", `/tasks/${task_id}/release`, { claim_seq }),
      ),
  );

  server.registerTool(
    "report_task",
    {
      title: "Report a task done or failed",
      description:
        "Ends your claim on a task. outcome done needs proof (gates run, commit, PR URL or a " +
        "summary); outcome failed needs a reason. A failed task is retried until it runs out " +
        "of attempts, then the tasks that depend on it are blocked.",
      inputSchema: z.object({
        task_id: IdSchema,
        claim_seq: claimSeq,
        outcome: z.enum(["done", "failed"]),
        proof: ProofSchema.optional().describe(
          "Required when outcome is done.",
        ),
        reason: z
          .string()
          .min(1)
          .max(TASK_CAPS.reason)
          .optional()
          .describe("Required when outcome is failed."),
      }),
      annotations: WRITE,
    },
    async ({ task_id, claim_seq, outcome, proof, reason }) => {
      if (outcome === "done") {
        if (proof === undefined) {
          return missing("proof is required when outcome is done.");
        }
        return toToolResult(
          await call("POST", `/tasks/${task_id}/done`, { claim_seq, proof }),
        );
      }
      if (reason === undefined) {
        return missing("reason is required when outcome is failed.");
      }
      return toToolResult(
        await call("POST", `/tasks/${task_id}/fail`, { claim_seq, reason }),
      );
    },
  );
}

function missing(message: string): ToolResult {
  return toToolResult({
    status: 400,
    body: { error: { code: "invalid_request", message } },
  });
}
