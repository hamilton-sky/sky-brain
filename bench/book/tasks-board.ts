// Bench tasks on the Board: reading projects and goals, doing a task end to end (claim, report or
// release), planning a goal, and attaching a document.
import { sql } from "drizzle-orm";
import {
  agentEntries,
  all,
  rows,
  said,
  task,
  taskEventKinds,
} from "./grade.ts";
import { json, type BenchTask } from "./task-types.ts";
import type { McpClient } from "./mcp.ts";
import type { Fixture } from "./seed.ts";

async function claimToggle(c: McpClient, fx: Fixture): Promise<number> {
  const claimed = await json<{ lease: { claim_seq: number } }>(
    c,
    "claim_task",
    {
      task_id: fx.tasks.toggle,
    },
  );
  return claimed.lease.claim_seq;
}

export const boardTasks: BenchTask[] = [
  {
    id: "board-projects",
    scope: "board",
    prompt: () => "Which projects do I have in sky-brain?",
    async gold(c) {
      await json(c, "list_projects", {});
      return "Recipe site and Garden planner.";
    },
    check: (_fx, t) =>
      all(
        [said(t, /recipe/i), "answer should name the recipe site"],
        [said(t, /garden/i), "answer should name the garden planner"],
      ),
  },
  {
    id: "board-next",
    scope: "board",
    prompt: () => "What's the next task I can work on in the recipe site?",
    async gold(c, fx) {
      await json(c, "next_task", { project_id: fx.project });
      return "Add a theme toggle (dark mode goal).";
    },
    check: (_fx, t) =>
      all([said(t, /toggle/i), "answer should name the theme toggle task"]),
  },
  {
    id: "board-empty",
    scope: "board",
    prompt: () => "Is there any task ready in the garden planner project?",
    async gold(c, fx) {
      await json(c, "next_task", { project_id: fx.emptyProject });
      return "No, nothing is ready there.";
    },
    check: (_fx, t) =>
      all(
        [
          said(t, /\b(no|nothing|none|not any)\b/i),
          "answer should say nothing is ready",
        ],
        [!said(t, /toggle/i), "named a task from another project"],
      ),
  },
  {
    id: "board-done",
    scope: "board",
    prompt: () =>
      "Take the next ready task in the recipe site and mark it done. Proof: 'Toggle added in the header, PR https://github.com/ann/recipe-site/pull/12'.",
    async gold(c, fx) {
      await json(c, "next_task", { project_id: fx.project });
      const seq = await claimToggle(c, fx);
      await json(c, "report_task", {
        task_id: fx.tasks.toggle,
        claim_seq: seq,
        outcome: "done",
        proof: {
          summary: "Toggle added in the header.",
          pr_url: "https://github.com/ann/recipe-site/pull/12",
        },
      });
      return "Done.";
    },
    async check(fx) {
      const tk = await task(fx, fx.tasks.toggle);
      return all(
        [tk.status === "done", `toggle task is ${tk.status}, not done`],
        [tk.proof != null, "no proof stored"],
      );
    },
  },
  {
    id: "board-release",
    scope: "board",
    trap: "release_task, not report_task failed",
    prompt: () =>
      "Claim the theme toggle task in the recipe site, then give it back without counting it as a failed attempt. I've changed my mind about who does it.",
    async gold(c, fx) {
      const seq = await claimToggle(c, fx);
      await json(c, "release_task", {
        task_id: fx.tasks.toggle,
        claim_seq: seq,
      });
      return "Claimed and released; no attempt counted.";
    },
    async check(fx) {
      const tk = await task(fx, fx.tasks.toggle);
      const kinds = await taskEventKinds(fx, fx.tasks.toggle);
      return all(
        [kinds.includes("claimed"), "task was never claimed"],
        [kinds.includes("released"), "task was not released"],
        [tk.attempts === 0, "an attempt was counted"],
        [tk.holder_actor === null, "task is still held"],
      );
    },
  },
  {
    id: "board-fail",
    scope: "board",
    trap: "failed needs a reason",
    prompt: () =>
      "Claim the theme toggle task in the recipe site, then report that it failed: the CSS build broke.",
    async gold(c, fx) {
      const seq = await claimToggle(c, fx);
      await json(c, "report_task", {
        task_id: fx.tasks.toggle,
        claim_seq: seq,
        outcome: "failed",
        reason: "The CSS build broke.",
      });
      return "Reported as failed; it will be retried.";
    },
    async check(fx) {
      const tk = await task(fx, fx.tasks.toggle);
      return all(
        [tk.attempts === 1, `attempts is ${tk.attempts}, not 1`],
        [
          /css/i.test(tk.fail_reason ?? ""),
          "reason should mention the CSS build",
        ],
      );
    },
  },
  {
    id: "board-propose",
    scope: "board",
    prompt: () =>
      "Plan a new goal for the recipe site: a print view for recipes, with three tasks: a print stylesheet, a print button, and a test on A4 paper (the test comes after the other two).",
    async gold(c, fx) {
      const g = await json<{ goal: { id: string } }>(c, "propose_goal", {
        project_id: fx.project,
        title: "Print view for recipes",
        body: "Recipes print cleanly on A4.",
      });
      await json(c, "add_tasks", {
        goal_id: g.goal.id,
        tasks: [
          { title: "Print stylesheet", body: "CSS for print." },
          { title: "Print button", body: "A button on each recipe." },
          {
            title: "Test on A4",
            body: "Print a few recipes on A4.",
            depends_on: [0, 1],
          },
        ],
      });
      return "Proposed as a draft goal with three tasks; approve it on sky-brain.";
    },
    async check(fx) {
      const goals = await rows<{ id: string; status: string }>(
        fx,
        sql`select id, status from goals where workspace_id = ${fx.workspaceId} and title ilike '%print%'`,
      );
      const g = goals[0];
      const n = g
        ? (await rows(fx, sql`select id from tasks where goal_id = ${g.id}`))
            .length
        : 0;
      const deps = g
        ? (
            await rows(
              fx,
              sql`select d.task_id from task_deps d join tasks t on t.id = d.task_id where t.goal_id = ${g.id}`,
            )
          ).length
        : 0;
      return all(
        [!!g, "no print goal"],
        [g?.status === "draft", "goal should be a draft"],
        [n === 3, `${n} tasks, not 3`],
        [deps >= 1, "the A4 test has no dependency"],
      );
    },
  },
  {
    id: "board-add-task",
    scope: "board",
    prompt: () =>
      "Add a task 'Test contrast with a checker' to the dark mode goal in the recipe site. It should come after picking the dark colours.",
    async gold(c, fx) {
      await json(c, "get_goal", { goal_id: fx.goals.darkMode });
      await json(c, "add_tasks", {
        goal_id: fx.goals.darkMode,
        tasks: [
          {
            title: "Test contrast with a checker",
            body: "Run a contrast checker on the dark palette.",
            depends_on: [fx.tasks.colors],
          },
        ],
      });
      return "Added; it waits for your approval because the goal is already approved.";
    },
    async check(fx) {
      const t = await rows<{ id: string }>(
        fx,
        sql`select id from tasks where goal_id = ${fx.goals.darkMode} and title ilike '%contrast%'`,
      );
      const dep = t[0]
        ? await rows(
            fx,
            sql`select 1 from task_deps where task_id = ${t[0].id} and depends_on_id = ${fx.tasks.colors}`,
          )
        : [];
      return all(
        [t.length === 1, "no contrast task"],
        [dep.length === 1, "it does not depend on the colours task"],
      );
    },
  },
  {
    id: "board-attach",
    scope: "board",
    trap: "capture first, then attach_document with the entry id",
    prompt: () =>
      "Write a short design note for the dark mode goal in the recipe site (which colours, where the toggle goes) and attach it to the goal.",
    async gold(c, fx) {
      const e = await json<{ entry: { id: string } }>(c, "capture", {
        kind: "decision",
        title: "Dark mode design note",
        body: "Dark grey background, warm text; toggle in the header, right side.",
        summary:
          "Dark mode: grey background, warm text, toggle at the header's right.",
      });
      await json(c, "attach_document", {
        goal_id: fx.goals.darkMode,
        entry_id: e.entry.id,
      });
      return "Attached to the goal.";
    },
    async check(fx) {
      const d = await rows(
        fx,
        sql`select 1 from goal_documents where goal_id = ${fx.goals.darkMode}`,
      );
      return all([
        d.length === 1,
        "no document attached to the dark mode goal",
      ]);
    },
  },
  {
    id: "board-waiting",
    scope: "board",
    prompt: () =>
      "Which goals in the recipe site are still waiting for my approval?",
    async gold(c, fx) {
      await json(c, "list_goals", { project_id: fx.project });
      return "Translate the site to Hebrew (draft).";
    },
    check: (_fx, t) =>
      all([said(t, /hebrew/i), "answer should name the Hebrew goal"]),
  },
  {
    id: "board-blocked",
    scope: "board",
    prompt: () =>
      "In the dark mode goal of the recipe site, which task can't start yet, and why?",
    async gold(c, fx) {
      await json(c, "get_goal", { goal_id: fx.goals.darkMode });
      return "Pick dark colours: it waits for the theme toggle task.";
    },
    check: (_fx, t) =>
      all(
        [said(t, /colou?rs/i), "answer should name the colours task"],
        [
          said(t, /toggle|depend|wait|after/i),
          "answer should give the dependency",
        ],
      ),
  },
  {
    id: "goal-count",
    scope: "board",
    trap: "the goal is named, not given by id",
    prompt: () =>
      "How many tasks does the dark mode goal in the recipe site have?",
    async gold(c, fx) {
      await json(c, "list_goals", { project_id: fx.project });
      await json(c, "get_goal", { goal_id: fx.goals.darkMode });
      return "Two.";
    },
    check: (_fx, t) => all([said(t, /\b(2|two)\b/i), "answer should say two"]),
  },
  {
    id: "across-before-work",
    scope: "across",
    trap: "read the brain before acting: the units preference applies to the task",
    prompt: () =>
      "Draft a short recipe card for a simple flatbread (just give me the text, don't save it). Use what you know about me.",
    async gold(c) {
      await json(c, "search", { q: "units preferences" });
      return "Flatbread: 250 g flour, 150 ml water, 5 g salt. Bake at 230 °C for 8 minutes.";
    },
    async check(fx, t) {
      const saved = (await agentEntries(fx)).length;
      return all(
        [
          said(t, /\d\s?(g|grams|ml|°c|celsius)\b/i),
          "recipe should use metric units",
        ],
        [
          !said(t, /\b(cups?|ounces?|oz|°f|fahrenheit)\b/i),
          "recipe used imperial units",
        ],
        [saved === 0, "saved an entry it was told not to"],
      );
    },
  },
];
