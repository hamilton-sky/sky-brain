// What the brain view shows for each part of the brain: how much it holds, what is waiting for
// the person, which agents work in it (from who wrote what, and when), and the links between
// parts (an entry whose `entry:<id>` ref points into another part). Pure helpers first, then
// the loader, which reads only routes the app already uses.
import {
  api,
  approvalsApi,
  entriesApi,
  type Approval,
  type EntrySummary,
  type Goal,
} from "../api.ts";
import type { EntryLayer } from "../router.ts";

export type Part = EntryLayer | "work";
export const PARTS: Part[] = ["core", "work", "short", "long"];

export const PART_NAMES: Record<Part, string> = {
  core: "About me",
  work: "Board",
  short: "Inbox",
  long: "Notebooks",
};

export const PART_ABOUT: Record<Part, string> = {
  core: "Who you are: languages, values, how you like to work. Only you write here, and every agent reads it first.",
  work: "What is being done now: goals, their tasks and their documents. When a goal closes, what is worth keeping becomes lessons in the Inbox.",
  short:
    "Where new things land, from agents and from you. Items fade after 30 days unless you keep them.",
  long: "What lasts: decisions, facts and lessons you kept. A kept note points back to where it came from.",
};

/** An agent counts as working in a part now when it wrote there in the last 10 minutes. */
const ACTIVE_MS = 10 * 60_000;
const LIST_LIMIT = 50;

export interface PartItem {
  id: string;
  /** Goals open on the board; entries open as a document. */
  kind: "goal" | "entry";
  title: string;
  meta: string;
  author: string;
  authorKind: "human" | "agent";
  at: string;
  refs: string[];
}

interface PartAgent {
  id: string;
  label: string;
  /** "Wrote 3 here, last 5 min ago". */
  does: string;
  activeNow: boolean;
}

export interface PartLink {
  from: Part;
  to: Part;
  label: string;
}

export interface PartData {
  part: Part;
  count: number;
  /** True when the list was cut at its limit, so the count is "at least". */
  more: boolean;
  waiting: number;
  items: PartItem[];
  agents: PartAgent[];
}

export type BrainData = Record<Part, PartData>;

/** `mcp/claude.ai/po` reads as `claude.ai/po`. */
export const agentLabel = (id: string) => id.replace(/^mcp\//, "");

export function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** The agents that wrote in a part, the latest first. */
function agentsIn(items: PartItem[], now: number): PartAgent[] {
  const by = new Map<string, { n: number; last: string }>();
  for (const it of items) {
    if (it.authorKind !== "agent") continue;
    const seen = by.get(it.author);
    if (!seen) by.set(it.author, { n: 1, last: it.at });
    else {
      seen.n++;
      if (it.at > seen.last) seen.last = it.at;
    }
  }
  return [...by.entries()]
    .sort((a, b) => (a[1].last < b[1].last ? 1 : -1))
    .map(([id, v]) => ({
      id,
      label: agentLabel(id),
      does: `Wrote ${v.n} here, last ${ago(v.last, now)}`,
      activeNow: now - Date.parse(v.last) < ACTIVE_MS,
    }));
}

/** The part each entry id lives in, across every part's items. */
function partOfEntries(data: BrainData): Map<string, Part> {
  const where = new Map<string, Part>();
  for (const p of PARTS) {
    for (const it of data[p].items)
      if (it.kind === "entry") where.set(it.id, p);
  }
  return where;
}

/**
 * The link an item shows: its `entry:<id>` ref into another part ("Came from Inbox"), or an
 * entry elsewhere that points at it ("Kept in About me").
 */
export function linkOf(
  data: BrainData,
  part: Part,
  item: PartItem,
): PartLink | null {
  const where = partOfEntries(data);
  for (const ref of item.refs) {
    const target = where.get(ref.replace(/^entry:/, ""));
    if (ref.startsWith("entry:") && target && target !== part) {
      return {
        from: target,
        to: part,
        label: `Came from ${PART_NAMES[target]}`,
      };
    }
  }
  for (const p of PARTS) {
    if (p === part) continue;
    const back = data[p].items.find((o) => o.refs.includes(`entry:${item.id}`));
    if (back) return { from: part, to: p, label: `Kept in ${PART_NAMES[p]}` };
  }
  return null;
}

/** Waiting approval items by part: entries wait in the Inbox, goals on the Board. */
function waitingByPart(pending: Approval[]): Record<Part, number> {
  const out: Record<Part, number> = { core: 0, work: 0, short: 0, long: 0 };
  for (const a of pending) {
    if (a.status !== "pending") continue;
    for (const i of a.items) {
      if (i.changed) continue;
      out[i.kind === "goal" ? "work" : "short"]++;
    }
  }
  return out;
}

export function entryItem(e: EntrySummary): PartItem {
  const who = e.author_kind === "agent" ? agentLabel(e.author) : "you";
  return {
    id: e.id,
    kind: "entry",
    title: e.title,
    meta: `${e.kind} · ${e.trust} · ${who}`,
    author: e.author,
    authorKind: e.author_kind,
    at: e.created_at,
    refs: e.refs,
  };
}

function goalItem(g: Goal): PartItem {
  const total = Object.values(g.counts).reduce((a, b) => a + b, 0);
  const done = g.counts.done ?? 0;
  return {
    id: g.id,
    kind: "goal",
    title: g.title,
    meta:
      g.status === "draft"
        ? "goal · draft, waiting for you"
        : `goal · ${done} of ${total} tasks done`,
    author: g.author,
    authorKind: g.author_kind,
    at: g.created_at,
    refs: [],
  };
}

/** Agents holding a task right now (a live lease), with what they work on. */
type Workers = Map<string, string>;

/** Merges the agents holding tasks into the Board's agents: they are the ones working now. */
function withWorkers(agents: PartAgent[], workers: Workers): PartAgent[] {
  const live = [...workers].map(([id, task]) => ({
    id,
    label: agentLabel(id),
    does: `Working on “${task}”`,
    activeNow: true,
  }));
  return [...live, ...agents.filter((a) => !workers.has(a.id))];
}

function partData(
  part: Part,
  items: PartItem[],
  waiting: number,
  now: number,
  workers: Workers = new Map(),
): PartData {
  return {
    part,
    count: items.length,
    more: items.length >= LIST_LIMIT,
    waiting,
    items,
    agents: part === "core" ? [] : withWorkers(agentsIn(items, now), workers),
  };
}

/** Goals of the person's projects that are not cancelled, newest first (five projects at most). */
async function boardGoals(): Promise<Goal[]> {
  const projects = (await api.projects()).slice(0, 5);
  const lists = await Promise.all(projects.map((p) => api.goals(p.id)));
  return lists
    .flatMap((l) => l.goals)
    .filter((g) => g.status !== "cancelled")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, LIST_LIMIT);
}

/**
 * Who holds a task now: goals with running tasks are read one by one (five at most), and a task
 * whose lease has not run out counts. This is how agents working the Board show up live.
 */
async function boardWorkers(goals: Goal[], now: number): Promise<Workers> {
  const running = goals
    .filter((g) => (g.counts.in_progress ?? 0) > 0)
    .slice(0, 5);
  const details = await Promise.all(
    running.map((g) => api.goal(g.id).catch(() => null)),
  );
  const out: Workers = new Map();
  for (const d of details) {
    for (const t of d?.tasks ?? []) {
      if (t.holder && Date.parse(t.holder.lease_expires_at) > now) {
        out.set(t.holder.actor, t.title);
      }
    }
  }
  return out;
}

/** Everything the brain view shows, from the routes the app already uses. */
export async function loadBrain(now = Date.now()): Promise<BrainData> {
  const [core, short, long, goals, pending] = await Promise.all([
    entriesApi.list("core", undefined, LIST_LIMIT),
    entriesApi.list("short", undefined, LIST_LIMIT),
    entriesApi.list("long", undefined, LIST_LIMIT),
    boardGoals(),
    approvalsApi.pending().catch(() => [] as Approval[]),
  ]);
  const waiting = waitingByPart(pending);
  const workers = await boardWorkers(goals, now);
  return {
    core: partData("core", core.map(entryItem), waiting.core, now),
    work: partData("work", goals.map(goalItem), waiting.work, now, workers),
    short: partData("short", short.map(entryItem), waiting.short, now),
    long: partData("long", long.map(entryItem), waiting.long, now),
  };
}

/** One colour per agent working now, for its signals in the brain. */
const AGENT_COLOURS = ["#ff9f6b", "#7fd3a0", "#f28fb5", "#ffd36b"];
export function activeColours(data: BrainData): Partial<Record<Part, string>> {
  const out: Partial<Record<Part, string>> = {};
  const ids: string[] = [];
  for (const p of PARTS) {
    const live = data[p].agents.find((a) => a.activeNow);
    if (!live) continue;
    if (!ids.includes(live.id)) ids.push(live.id);
    out[p] = AGENT_COLOURS[ids.indexOf(live.id) % AGENT_COLOURS.length];
  }
  return out;
}

export function countText(d: PartData): string {
  const n = `${d.count}${d.more ? "+" : ""}`;
  if (d.part === "work") return `${n} goals`;
  if (d.part === "short") return `${n} new`;
  if (d.part === "core") return `${n} about you`;
  return `${n} notes`;
}
