// The test brain every bench task starts from: one person (Ann) with entries in every layer, a
// second Notebook, a version history, a conflict between layers, and a board with an approved goal
// (one task ready, one waiting on it) and a draft goal. Built fresh for each trial, in memory.
import type { Actor } from "@sky-brain/shared/actor";
import { and, eq } from "drizzle-orm";
import {
  entries,
  entryVersions,
  memories,
} from "../../apps/server/src/db/schema.ts";
import { createRateLimiter } from "../../apps/server/src/guards/ratelimit.ts";
import { boardDispatcher } from "../../apps/server/src/mcp/board-dispatch.ts";
import {
  createTestDb,
  seedEntry,
  seedProject,
  seedWorkspace,
  type Db,
} from "../../apps/server/src/testing/harness.ts";

const PERSON = "ann";
const AGENT_ID = "mcp/bench.test";
export const AGENT: Actor = {
  kind: "agent",
  agent_id: AGENT_ID,
  on_behalf_of: PERSON,
};
const HUMAN: Actor = { kind: "human", user_id: PERSON };

/** The ids tasks and graders refer to. */
export interface Fixture {
  db: Db;
  workspaceId: string;
  memories: { core: string; notebook: string; worklog: string; inbox: string };
  entries: {
    metric: string;
    coffeeBlack: string;
    hosting: string;
    database: string;
    deployDay: string;
    darkModeIdea: string;
    signupHypothesis: string;
    coffeeMilk: string;
    agentNote: string;
  };
  project: string;
  emptyProject: string;
  goals: { darkMode: string; hebrew: string };
  tasks: { toggle: string; colors: string };
  approval: string;
}

export const NOW = new Date("2026-11-25T09:00:00Z");

async function memoryId(
  db: Db,
  workspaceId: string,
  layer: "core" | "long" | "short",
) {
  const [m] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(
      and(
        eq(memories.workspaceId, workspaceId),
        eq(memories.layer, layer),
        eq(memories.isDefault, true),
      ),
    );
  return m!.id;
}

function check<T>(res: { status: number; body: unknown }, what: string): T {
  if (res.status >= 300)
    throw new Error(`seed ${what}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

export async function seedBrain(): Promise<Fixture> {
  const db = await createTestDb();
  const ws = await seedWorkspace(db, {
    name: "Ann's brain",
    members: [{ userId: PERSON, role: "owner" }],
  });
  const workspaceId = ws.id;
  const core = await memoryId(db, workspaceId, "core");
  const notebook = await memoryId(db, workspaceId, "long");
  const inbox = await memoryId(db, workspaceId, "short");
  const [wl] = await db
    .insert(memories)
    .values({ workspaceId, layer: "long", name: "Work log", isDefault: false })
    .returning({ id: memories.id });
  const worklog = wl!.id;

  const approved = { workspaceId, trust: "approved" as const };
  const e = async (o: Parameters<typeof seedEntry>[1]) =>
    (await seedEntry(db, o)).id;
  const ids = {
    metric: await e({
      ...approved,
      layer: "core",
      kind: "fact",
      title: "Units",
      body: "Ann uses metric units: grams, litres and degrees Celsius, in recipes and everywhere else.",
      summary: "Ann prefers metric units.",
    }),
    coffeeBlack: await e({
      ...approved,
      layer: "core",
      kind: "fact",
      title: "Coffee",
      body: "Ann drinks her coffee black, no sugar.",
      summary: "Ann drinks coffee black.",
    }),
    hosting: await e({
      ...approved,
      layer: "long",
      kind: "decision",
      title: "Host the recipe site on Vercel",
      body: "We host the recipe site on Vercel. Render was ruled out because its free tier sleeps after 15 minutes and the first visitor waits half a minute.",
      summary: "The recipe site is hosted on Vercel.",
    }),
    database: await e({
      ...approved,
      layer: "long",
      kind: "decision",
      title: "MongoDB for the recipe site",
      body: "The recipe site stores recipes in MongoDB.",
      summary: "The recipe site uses MongoDB.",
    }),
    deployDay: await e({
      ...approved,
      memoryId: worklog,
      layer: "long",
      kind: "fact",
      title: "Deploy day",
      body: "We deploy the recipe site on Thursdays, after the weekly review.",
      summary: "Deploys happen on Thursdays.",
    }),
    darkModeIdea: await e({
      workspaceId,
      trust: "proposed",
      layer: "short",
      kind: "hypothesis",
      title: "Idea: dark mode",
      body: "Readers cook at night; a dark mode might help.",
      summary: "Idea: add a dark mode to the recipe site.",
      authorKind: "agent",
      author: "mcp/claude.ai",
    }),
    signupHypothesis: await e({
      workspaceId,
      trust: "proposed",
      layer: "short",
      kind: "hypothesis",
      title: "Sign-up drop-off",
      body: "People may leave at sign-up because the confirmation email arrives late.",
      summary:
        "Guess: users drop off at sign-up because the confirmation email is slow.",
      authorKind: "agent",
      author: "mcp/claude.ai",
    }),
    coffeeMilk: await e({
      workspaceId,
      trust: "proposed",
      layer: "short",
      kind: "fact",
      title: "Coffee with milk",
      body: "Ann takes milk in her coffee.",
      summary: "Ann takes milk in coffee.",
      authorKind: "agent",
      author: "mcp/chatgpt.com",
    }),
    agentNote: await e({
      workspaceId,
      trust: "proposed",
      layer: "short",
      kind: "fact",
      title: "Ratings use five stars",
      body: "Recipe ratings are one to five stars, whole stars only.",
      summary: "Ratings are 1 to 5 whole stars.",
      authorKind: "agent",
      author: AGENT_ID,
    }),
  };

  // A second version of the database decision: version 1 said MongoDB (versions are
  // append-only, so the entry was seeded with the old text and moves to version 2 here).
  const [v1] = await db
    .select()
    .from(entryVersions)
    .where(eq(entryVersions.entryId, ids.database));
  const v2 = {
    title: "Postgres for the recipe site",
    body: "The recipe site stores recipes in Postgres, not MongoDB: recipes, tags and ratings are relational.",
    summary: "The recipe site uses Postgres.",
  };
  await db.insert(entryVersions).values({ ...v1!, version: 2, ...v2 });
  await db
    .update(entries)
    .set({ version: 2, ...v2 })
    .where(eq(entries.id, ids.database));

  const project = (
    await seedProject(db, {
      workspaceId,
      slug: "recipe-site",
      name: "Recipe site",
      gitRemote: "https://github.com/ann/recipe-site",
    })
  ).id;
  const emptyProject = (
    await seedProject(db, {
      workspaceId,
      slug: "garden-planner",
      name: "Garden planner",
    })
  ).id;

  const board = boardDispatcher({
    db,
    now: () => NOW,
    limiter: createRateLimiter({ now: () => NOW.getTime() }),
  });
  const asHuman = board.forActor(HUMAN);
  const asAgent = board.forActor(AGENT);
  const dark = check<{ goal: { id: string } }>(
    await asHuman("POST", "/goals", {
      project_id: project,
      title: "Add dark mode",
      body: "A dark theme for the recipe site, switchable from the header.",
      executor: "single",
    }),
    "dark goal",
  ).goal.id;
  const added = check<{ tasks: { id: string }[] }>(
    await asHuman("POST", `/goals/${dark}/tasks`, {
      tasks: [
        {
          title: "Add a theme toggle",
          body: "A toggle in the header that switches light and dark.",
        },
        {
          title: "Pick dark colours",
          body: "Dark palette with readable contrast for recipe cards.",
          depends_on: [0],
        },
      ],
    }),
    "dark tasks",
  ).tasks;
  check(await asHuman("POST", `/goals/${dark}/approve`, {}), "approve dark");
  const hebrew = check<{ goal: { id: string } }>(
    await asAgent("POST", "/goals", {
      project_id: project,
      title: "Translate the site to Hebrew",
      body: "Hebrew UI strings and right-to-left layout.",
      executor: "single",
    }),
    "hebrew goal",
  ).goal.id;
  const approval = check<{ approval: { id: string } }>(
    await asAgent("POST", "/approvals", {
      items: [{ kind: "entry", id: ids.agentNote }],
      reason: "Keep the star-rating fact.",
    }),
    "approval",
  ).approval.id;

  return {
    db,
    workspaceId,
    memories: { core, notebook, worklog, inbox },
    entries: ids,
    project,
    emptyProject,
    goals: { darkMode: dark, hebrew },
    tasks: { toggle: added[0]!.id, colors: added[1]!.id },
    approval,
  };
}
