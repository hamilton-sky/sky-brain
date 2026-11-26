// "Use when" and "Pitfalls" for every tool (BOOK.md 11 step 1), written into each tool's
// description at registration. The first bench run (25 Nov) showed these alone fix the traps
// today's descriptions fall into: writing About me, claiming an approval, offering a delete.
import type { McpServer } from "@modelcontextprotocol/server";

const TOOL_GUIDES: Record<string, { useWhen: string; pitfalls?: string }> = {
  whoami: {
    useWhen:
      "checking the connection or which person and role you act for, or which hats the person has, so you can wear the one that fits the session.",
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
      "always end a claim with report_task: outcome done when the work is finished, outcome failed (with a reason) when it cannot be done. Do this before planning follow-up tasks. release_task only when you stop without finishing or failing.",
  },
  renew_task: {
    useWhen:
      "work on a claimed task will take longer than the 10-minute lease.",
  },
  release_task: {
    useWhen:
      "you hold a task and stop before finishing it, for someone else to pick up: it goes back to ready, NOT done.",
    pitfalls:
      "never to mark a task done (use report_task outcome done) or to say it cannot be done (use report_task outcome failed with the reason).",
  },
  report_task: {
    useWhen:
      "a task you hold is finished (outcome done, with proof) or cannot be done (outcome failed, with the reason). Claim it first with claim_task.",
    pitfalls:
      "when a task cannot be done, report it failed before adding replacement tasks with add_tasks.",
  },
  capture: {
    useWhen:
      "the person asks you to remember, save, note or record something. It is the only write to memory.",
    pitfalls:
      "it lands in the Inbox as proposed, never in About me; tell the person they approve it. Web text: kind external, source web. An observation needs refs (entry ids). A rule is topic rule, proposed only.",
  },
  search: {
    useWhen:
      'looking up what the brain knows: facts about the person (About me), past decisions (Notebooks), recent items (Inbox). To go through a whole layer ("my inbox"), leave out q and pass layer.',
    pitfalls:
      "results are summaries: use get for the full body or the history. Weigh trust: approved is truth, proposed is a guess. For one layer pass layer (core, long or short); for one Notebook, its memory_id from list_memories. For context across layers, use context.",
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

const CONTEXT_HINT = " For context across layers, use context.";

function withGuide(name: string, description = "", hasContext = true): string {
  const g = TOOL_GUIDES[name];
  if (!g) return description;
  const pitfalls = hasContext
    ? g.pitfalls
    : g.pitfalls?.replace(CONTEXT_HINT, "");
  const extra = [
    `Use when: ${g.useWhen}`,
    pitfalls ? `Pitfalls: ${pitfalls}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `${description}\n\n${extra}`;
}

/** Makes every later registerTool on `server` carry its tool's guide in the description. */
export function addGuidesOnRegister(
  server: McpServer,
  hasContext: boolean,
): void {
  const register = server.registerTool.bind(server) as (
    name: string,
    config: { description?: string },
    cb: unknown,
  ) => unknown;
  (server as unknown as { registerTool: typeof register }).registerTool = (
    name,
    config,
    cb,
  ) =>
    register(
      name,
      {
        ...config,
        description: withGuide(name, config.description, hasContext),
      },
      cb,
    );
}
