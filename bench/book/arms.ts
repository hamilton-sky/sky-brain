// The three arms (BOOK.md section 10). A: today's tools as the server lists them. B: the same
// tools with "Use when" and "Pitfalls" written into each description. C: B plus the server
// instructions and one read-only `book { id? }` tool. Only the bench sees B and C: nothing here
// changes what the live server shows a model.
import type { McpTool } from "./mcp.ts";
import { bookTool, readBook, SERVER_INSTRUCTIONS } from "./book.ts";
import type { Fixture } from "./seed.ts";

export type ArmId = "A" | "B" | "C";
export const ARMS: ArmId[] = ["A", "B", "C"];

/** Use-when and pitfalls per tool, taken from the book's layer chapters. */
const GUIDE: Record<string, { useWhen: string; pitfalls?: string }> = {
  whoami: {
    useWhen: "checking the connection or which person and role you act for.",
  },
  list_projects: {
    useWhen:
      "you need a project_id for the board tools and only know the project's name.",
  },
  list_goals: {
    useWhen:
      "you need a goal_id, or want to see which goals are draft (waiting for the person) or approved.",
  },
  get_goal: {
    useWhen: "you need a goal's tasks, their order, dependencies or status.",
    pitfalls: "needs goal_id; find it with list_goals first.",
  },
  propose_goal: {
    useWhen:
      "the person asks you to plan new work. Then add its tasks with add_tasks.",
    pitfalls:
      "the goal stays a draft; never say it is approved. Ask with request_approval.",
  },
  add_tasks: {
    useWhen: "adding tasks to a goal you proposed or the person named.",
    pitfalls:
      "depends_on is an index into this call's list or an existing task id from get_goal.",
  },
  attach_document: {
    useWhen:
      "a goal needs a design note or spec the person should read on the board card.",
    pitfalls:
      "capture the document first, then attach the entry_id capture returned.",
  },
  next_task: {
    useWhen: "asked what can be worked on now. Read-only: it does not claim.",
    pitfalls:
      "needs project_id (list_projects). task: null means nothing is ready.",
  },
  claim_task: {
    useWhen:
      "you are about to do a task. Keep claim_seq for renew, release and report.",
    pitfalls:
      "always end a claim: report_task when finished or failed, release_task to give it back.",
  },
  renew_task: {
    useWhen:
      "work on a claimed task will take longer than the 10-minute lease.",
  },
  release_task: {
    useWhen:
      "you hold a task but will not finish it: it goes back to ready and no attempt is counted.",
    pitfalls: "not report_task failed, which counts an attempt.",
  },
  report_task: {
    useWhen:
      "a task you hold is finished (outcome done, with proof) or could not be done (outcome failed, with reason).",
    pitfalls:
      "to give a task back without a failure, use release_task instead.",
  },
  capture: {
    useWhen:
      "the person asks you to remember, save, note or record something. It is the only write to memory.",
    pitfalls:
      "it lands in the Inbox as proposed, never in About me; tell the person they approve it. Web text: kind external, source web. An observation needs refs (entry ids). A rule is topic rule, proposed only.",
  },
  search: {
    useWhen:
      "looking up what the brain knows: facts about the person (About me), past decisions (Notebooks), recent items (Inbox).",
    pitfalls:
      "results are summaries: use get for the full body or the history. Weigh trust: approved is truth, proposed is a guess. To look in one Notebook, pass its memory_id from list_memories.",
  },
  get: {
    useWhen:
      "you need an entry's full text, or what was believed before (versions).",
    pitfalls: "needs an entry_id from search.",
  },
  list_memories: {
    useWhen:
      "asked which Notebooks or Inboxes exist, or you need a memory_id to search one of them.",
    pitfalls: "it lists containers, not their entries; use search for content.",
  },
  request_approval: {
    useWhen:
      "the person wants to approve a draft goal or proposed entry, or asks you to approve something.",
    pitfalls:
      "you cannot approve, reject or delete. Show the person the link it returns.",
  },
  approval_status: {
    useWhen: "checking whether the person answered an approval request.",
  },
};

function withGuide(tool: McpTool): McpTool {
  const g = GUIDE[tool.name];
  if (!g) return tool;
  const extra = [
    `Use when: ${g.useWhen}`,
    g.pitfalls ? `Pitfalls: ${g.pitfalls}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { ...tool, description: `${tool.description ?? ""}\n\n${extra}` };
}

export interface Arm {
  id: ArmId;
  tools: McpTool[];
  /** Server instructions, if the arm has any (clients put them in the system prompt). */
  instructions?: string;
  /** Answers calls to tools the bench adds (the book); undefined for real server tools. */
  local(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string | undefined>;
}

export function buildArm(id: ArmId, serverTools: McpTool[], fx: Fixture): Arm {
  const none = () => Promise.resolve(undefined);
  if (id === "A") return { id, tools: serverTools, local: none };
  const described = serverTools.map(withGuide);
  if (id === "B") return { id, tools: described, local: none };
  return {
    id,
    tools: [bookTool, ...described],
    instructions: SERVER_INSTRUCTIONS,
    local: (name, args) =>
      name === bookTool.name
        ? readBook(fx, args.id as string | undefined)
        : Promise.resolve(undefined),
  };
}

export function missingGuides(serverTools: McpTool[]): string[] {
  return serverTools.map((t) => t.name).filter((n) => !GUIDE[n]);
}
