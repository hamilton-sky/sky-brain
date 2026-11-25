// Complex scenarios (added 25 Nov, after the first run): each needs several tools across layers
// in the right order. Written after arm B's descriptions and the book, so they count as held out.
// Run them alone with `--set complex`.
import { sql } from "drizzle-orm";
import { agentEntries, all, rows, said, task } from "./grade.ts";
import { json, type BenchTask } from "./task-types.ts";

export const complexTasks: BenchTask[] = [
  {
    id: "x-inbox-to-plan",
    scope: "across",
    trap: "read the Inbox, plan on the Board, then ask for approval",
    prompt: () =>
      "Turn the guess in my inbox about people leaving at sign-up into a plan: a goal in the recipe site with two tasks, first measure how long the confirmation email takes, then fix it. Then ask me to approve the goal.",
    async gold(c, fx) {
      await json(c, "search", { q: "sign-up" });
      const g = await json<{ goal: { id: string } }>(c, "propose_goal", {
        project_id: fx.project,
        title: "Fix sign-up drop-off",
        body: "Check whether a slow confirmation email makes people leave at sign-up.",
      });
      await json(c, "add_tasks", {
        goal_id: g.goal.id,
        tasks: [
          { title: "Measure the confirmation email delay", body: "Time it." },
          {
            title: "Fix the email delay",
            body: "Make it fast.",
            depends_on: [0],
          },
        ],
      });
      await json(c, "request_approval", {
        items: [{ kind: "goal", id: g.goal.id }],
        reason: "Plan from the sign-up guess.",
      });
      return "Proposed the goal with two tasks; approve it here: http://localhost:3000/a/...";
    },
    async check(fx) {
      const goals = await rows<{ id: string }>(
        fx,
        sql`select id from goals where workspace_id = ${fx.workspaceId} and status = 'draft' and id <> ${fx.goals.hebrew}`,
      );
      const g = goals[0];
      const n = g
        ? (await rows(fx, sql`select 1 from tasks where goal_id = ${g.id}`))
            .length
        : 0;
      const dep = g
        ? (
            await rows(
              fx,
              sql`select 1 from task_deps d join tasks t on t.id = d.task_id where t.goal_id = ${g.id}`,
            )
          ).length
        : 0;
      const asked = g
        ? await rows<{ items: { id: string }[] }>(
            fx,
            sql`select items from approval_requests where workspace_id = ${fx.workspaceId}`,
          )
        : [];
      return all(
        [!!g, "no new draft goal"],
        [n === 2, `${n} tasks, not 2`],
        [dep >= 1, "the fix does not wait for the measurement"],
        [
          asked.some((r) => r.items.some((i) => i.id === g?.id)),
          "no approval request for the goal",
        ],
      );
    },
  },
  {
    id: "x-work-session",
    scope: "across",
    trap: "claim, report done with proof, then capture: three layers in order",
    prompt: () =>
      "Do the next ready task in the recipe site end to end: take it, mark it done with the proof 'Toggle shipped in the header', and then save a note in my inbox that the theme toggle is live.",
    async gold(c, fx) {
      await json(c, "next_task", { project_id: fx.project });
      const cl = await json<{ lease: { claim_seq: number } }>(c, "claim_task", {
        task_id: fx.tasks.toggle,
      });
      await json(c, "report_task", {
        task_id: fx.tasks.toggle,
        claim_seq: cl.lease.claim_seq,
        outcome: "done",
        proof: { summary: "Toggle shipped in the header." },
      });
      await json(c, "capture", {
        kind: "fact",
        title: "Theme toggle is live",
        body: "The theme toggle is live in the recipe site's header.",
        summary: "The recipe site's theme toggle is live.",
      });
      return "Done, and noted in your Inbox.";
    },
    async check(fx) {
      const tk = await task(fx, fx.tasks.toggle);
      const note = (await agentEntries(fx)).find((e) =>
        /toggle/i.test(e.body + e.title),
      );
      return all(
        [tk.status === "done", `task is ${tk.status}`],
        [!!note, "no Inbox note about the toggle"],
      );
    },
  },
  {
    id: "x-conflict-observation",
    scope: "across",
    trap: "find both sides of a conflict, cite both, say which is approved",
    prompt: () =>
      "Check whether what my inbox says about my coffee agrees with my About me. If they disagree, save an observation that points to both entries, and tell me which one is approved.",
    async gold(c, fx) {
      await json(c, "search", { q: "coffee" });
      await json(c, "capture", {
        kind: "observation",
        title: "Coffee entries disagree",
        body: "About me says black; an Inbox entry says milk.",
        summary: "Two entries disagree on how Ann takes coffee.",
        refs: [fx.entries.coffeeBlack, fx.entries.coffeeMilk],
      });
      return "They disagree. About me (black) is approved; the milk note is only proposed.";
    },
    async check(fx, t) {
      const o = (await agentEntries(fx)).find((e) => e.kind === "observation");
      const refs = (o?.refs ?? []).join(" ");
      return all(
        [!!o, "no observation saved"],
        [
          refs.includes(fx.entries.coffeeBlack) &&
            refs.includes(fx.entries.coffeeMilk),
          "observation does not cite both entries",
        ],
        [said(t, /black/i), "answer should say the approved one is black"],
      );
    },
  },
  {
    id: "x-fail-and-replan",
    scope: "board",
    trap: "report failed with a reason, then add a new task to the same goal",
    prompt: () =>
      "Take the theme toggle task in the recipe site. It can't be done: the header component is missing. Report that, then add a task 'Build the header component' to the same goal.",
    async gold(c, fx) {
      const cl = await json<{ lease: { claim_seq: number } }>(c, "claim_task", {
        task_id: fx.tasks.toggle,
      });
      await json(c, "report_task", {
        task_id: fx.tasks.toggle,
        claim_seq: cl.lease.claim_seq,
        outcome: "failed",
        reason: "The header component is missing.",
      });
      await json(c, "add_tasks", {
        goal_id: fx.goals.darkMode,
        tasks: [
          {
            title: "Build the header component",
            body: "The toggle needs a header component.",
          },
        ],
      });
      return "Reported as failed and added the header task; it waits for your approval.";
    },
    async check(fx) {
      const tk = await task(fx, fx.tasks.toggle);
      const added = await rows(
        fx,
        sql`select 1 from tasks where goal_id = ${fx.goals.darkMode} and title ilike '%header component%'`,
      );
      return all(
        [tk.attempts === 1, `attempts is ${tk.attempts}, not 1`],
        [/header/i.test(tk.fail_reason ?? ""), "reason should name the header"],
        [added.length === 1, "no header task added"],
      );
    },
  },
  {
    id: "x-reverse-decision",
    scope: "across",
    trap: "read the old decision and its history, save the new one citing it, ask for approval",
    prompt: () =>
      "We're thinking of moving the recipe site back to MongoDB. Check what we decided before and why, save the new decision with a reference to the old one, and send me an approval request for it.",
    async gold(c, fx) {
      await json(c, "search", { q: "database recipe site" });
      await json(c, "get", { entry_id: fx.entries.database });
      const e = await json<{ entry: { id: string } }>(c, "capture", {
        kind: "decision",
        title: "Move the recipe site back to MongoDB",
        body: "Proposed: move back to MongoDB, reversing the Postgres decision.",
        summary: "Proposal to move the recipe site back to MongoDB.",
        refs: [fx.entries.database],
      });
      await json(c, "request_approval", {
        items: [{ kind: "entry", id: e.entry.id }],
        reason: "New database decision.",
      });
      return "Before: Postgres, because the data is relational. Saved the new decision; approve it here: http://localhost:3000/a/...";
    },
    async check(fx, t) {
      const d = (await agentEntries(fx)).find(
        (e) => e.kind === "decision" && /mongo/i.test(e.body + e.title),
      );
      const asked = await rows<{ items: { id: string }[] }>(
        fx,
        sql`select items from approval_requests where workspace_id = ${fx.workspaceId} and id <> ${fx.approval}`,
      );
      return all(
        [!!d, "no new decision saved"],
        [
          (d?.refs ?? []).some((r) => r.includes(fx.entries.database)),
          "the decision does not cite the old one",
        ],
        [
          asked.some((r) => r.items.some((i) => i.id === d?.id)),
          "no approval request for it",
        ],
        [
          said(t, /relational/i),
          "answer should give the old reason (relational data)",
        ],
      );
    },
  },
  {
    id: "x-status-report",
    scope: "across",
    prompt: () =>
      "Give me a short status report on the recipe site: which goals wait for my approval, what the next task is, which database it uses, and where it is hosted.",
    async gold(c, fx) {
      await json(c, "list_goals", { project_id: fx.project });
      await json(c, "next_task", { project_id: fx.project });
      await json(c, "search", { q: "recipe site database hosting" });
      return "Waiting: Hebrew translation. Next: Add a theme toggle. Postgres, hosted on Vercel.";
    },
    check: (_fx, t) =>
      all(
        [said(t, /hebrew/i), "no Hebrew goal"],
        [said(t, /toggle/i), "no next task"],
        [said(t, /vercel/i), "no hosting"],
        [said(t, /postgres/i), "no database"],
      ),
  },
];
