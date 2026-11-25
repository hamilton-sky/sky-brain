// Cross-layer scenarios (added 25 Nov with arm D): each answer needs About me, a Notebook (the
// default one or the Work log), the Inbox and the Board at once, the case `context` and the book
// are for. Written after the descriptions and the book, so they count as held out. Run them alone
// with `--set across`.
import { sql } from "drizzle-orm";
import { agentEntries, all, rows, said } from "./grade.ts";
import { json, type BenchTask } from "./task-types.ts";

export const acrossTasks: BenchTask[] = [
  {
    id: "y-brief",
    scope: "across",
    trap: "one answer from four layers, including a fact only in a second Notebook",
    prompt: () =>
      "A new helper takes over the recipe site tomorrow. Write them a short brief: which units I use, which database the site uses and why, where it is hosted and why not Render, which day we deploy, and what is being built right now.",
    async gold(c) {
      await json(c, "context", {
        q: "recipe site units database hosting deploy",
      });
      await json(c, "list_projects", {});
      return "Metric units. Postgres, because recipes, tags and ratings are relational. Hosted on Vercel; Render's free tier sleeps. Deploys on Thursdays. Now: dark mode, starting with the theme toggle.";
    },
    check: (_fx, t) =>
      all(
        [said(t, /metric|grams|celsius/i), "no units"],
        [said(t, /postgres/i), "no database"],
        [said(t, /relational/i), "no reason for the database"],
        [said(t, /vercel/i), "no hosting"],
        [
          said(t, /sleep|wak|15 minutes|half a minute/i),
          "no reason against Render",
        ],
        [said(t, /thursday/i), "no deploy day (it is in the Work log)"],
        [said(t, /dark|toggle/i), "nothing about the work under way"],
      ),
  },
  {
    id: "y-plan-in-context",
    scope: "across",
    trap: "a plan that has to respect About me and the Notebooks without being told what they say",
    prompt: () =>
      "Plan a 'recipe import' feature for the recipe site: a goal with two or three tasks. Before you write it, check what I prefer and what we already decided about the site, and make the plan follow it. Then ask me to approve the goal.",
    async gold(c, fx) {
      await json(c, "context", { q: "recipe site import" });
      const g = await json<{ goal: { id: string } }>(c, "propose_goal", {
        project_id: fx.project,
        title: "Recipe import",
        body: "Import recipes into the Postgres tables, converting quantities to metric (grams, Celsius). Ship on a Thursday deploy.",
      });
      await json(c, "add_tasks", {
        goal_id: g.goal.id,
        tasks: [
          { title: "Parse imported recipes", body: "Read the source format." },
          {
            title: "Convert units to metric",
            body: "Grams, litres, Celsius.",
            depends_on: [0],
          },
          {
            title: "Store in Postgres",
            body: "Recipes, tags, ratings.",
            depends_on: [1],
          },
        ],
      });
      await json(c, "request_approval", {
        items: [{ kind: "goal", id: g.goal.id }],
        reason: "Recipe import plan.",
      });
      return "Planned recipe import in metric, on Postgres; approve it here.";
    },
    async check(fx) {
      const goals = await rows<{ id: string; text: string }>(
        fx,
        sql`select g.id, g.title || ' ' || g.body || ' ' || coalesce(string_agg(t.title || ' ' || t.body, ' '), '') as text
            from goals g left join tasks t on t.goal_id = g.id
            where g.workspace_id = ${fx.workspaceId} and g.status = 'draft' and g.id <> ${fx.goals.hebrew}
            group by g.id`,
      );
      const g = goals[0];
      const asked = await rows<{ items: { id: string }[] }>(
        fx,
        sql`select items from approval_requests where workspace_id = ${fx.workspaceId} and id <> ${fx.approval}`,
      );
      return all(
        [!!g, "no new draft goal"],
        [
          /metric|gram|celsius/i.test(g?.text ?? ""),
          "the plan ignores Ann's units",
        ],
        [
          /postgres/i.test(g?.text ?? ""),
          "the plan ignores the database decision",
        ],
        [!/mongo/i.test(g?.text ?? ""), "the plan uses the old database"],
        [
          asked.some((r) => r.items.some((i) => i.id === g?.id)),
          "no approval request for the goal",
        ],
      );
    },
  },
  {
    id: "y-inbox-conflicts",
    scope: "across",
    trap: "find a conflict nobody named, between the Inbox and an approved layer",
    prompt: () =>
      "Go through my inbox and find anything that contradicts what is approved elsewhere in my brain. For each contradiction, save an observation that cites both entries, and tell me which side is approved.",
    async gold(c, fx) {
      await json(c, "search", { layer: "short" });
      await json(c, "context", { q: "coffee milk black" });
      await json(c, "capture", {
        kind: "observation",
        title: "Coffee entries disagree",
        body: "About me says black; an Inbox entry says milk.",
        summary: "Two entries disagree on how Ann takes coffee.",
        refs: [fx.entries.coffeeBlack, fx.entries.coffeeMilk],
      });
      return "One contradiction: About me (approved) says black coffee; the Inbox note with milk is only proposed.";
    },
    async check(fx, t) {
      const obs = (await agentEntries(fx)).filter(
        (e) => e.kind === "observation",
      );
      const cites = obs.some((o) => {
        const refs = (o.refs ?? []).join(" ");
        return (
          refs.includes(fx.entries.coffeeBlack) &&
          refs.includes(fx.entries.coffeeMilk)
        );
      });
      return all(
        [cites, "no observation citing both coffee entries"],
        [said(t, /black/i), "answer should say the approved side is black"],
      );
    },
  },
  {
    id: "y-weekly-review",
    scope: "across",
    trap: "a review that reads every layer, then writes once to the Inbox",
    prompt: () =>
      "Weekly review of my brain: which goals wait for my approval, which inbox entries are still only proposed, and what is ready to work on. Then save one short note in my inbox that summarises the review.",
    async gold(c, fx) {
      await json(c, "list_goals", { project_id: fx.project });
      await json(c, "next_task", { project_id: fx.project });
      await json(c, "search", { q: "idea sign-up coffee", layer: "short" });
      await json(c, "capture", {
        kind: "fact",
        title: "Weekly review",
        body: "Waiting: Hebrew goal. Proposed: dark mode idea, sign-up drop-off, coffee with milk. Ready: theme toggle.",
        summary: "Weekly review: Hebrew waits, toggle is ready.",
      });
      return "Waiting for you: Translate the site to Hebrew. Proposed in the Inbox: the dark mode idea, the sign-up drop-off guess, coffee with milk. Ready: Add a theme toggle.";
    },
    async check(fx, t) {
      const note = (await agentEntries(fx)).find((e) =>
        /review|hebrew|toggle/i.test(e.title + e.body),
      );
      return all(
        [said(t, /hebrew/i), "no goal waiting for approval"],
        [said(t, /sign-?up/i), "misses the sign-up guess in the Inbox"],
        [said(t, /toggle/i), "no ready task"],
        [!!note, "no review note saved"],
      );
    },
  },
];
