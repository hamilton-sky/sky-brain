// Scores for one bench run: per model and arm, pass^1 and pass^3 on each split, by scope, and
// the call and token counts. Printed as markdown and written to results/<label>.json.
import type { Scope } from "./task-types.ts";
import type { Split } from "./tasks.ts";
import type { TrialUsage } from "./agent.ts";

export interface TrialRecord {
  model: string;
  arm: string;
  task: string;
  split: Split;
  scope: Scope;
  trial: number;
  pass: boolean;
  why: string | null;
  calls: { name: string; isError: boolean }[];
  wrongTool: number;
  invalidArgs: number;
  extraCalls: number;
  bookCalls: number;
  usage: TrialUsage;
  stop: string;
  answer: string;
}

interface Score {
  pass1: number;
  passK: number;
  tasks: number;
}

function score(records: TrialRecord[]): Score {
  const byTask = new Map<string, boolean[]>();
  for (const r of records)
    byTask.set(r.task, [...(byTask.get(r.task) ?? []), r.pass]);
  const tasks = [...byTask.values()];
  if (!tasks.length) return { pass1: 0, passK: 0, tasks: 0 };
  const pass1 =
    tasks.reduce((s, t) => s + t.filter(Boolean).length / t.length, 0) /
    tasks.length;
  const passK = tasks.filter((t) => t.every(Boolean)).length / tasks.length;
  return { pass1, passK, tasks: tasks.length };
}

const pct = (s: Score, k: "pass1" | "passK") =>
  s.tasks ? `${Math.round(s[k] * 100)}%` : "-";
const avg = (rs: TrialRecord[], f: (r: TrialRecord) => number) =>
  rs.length ? rs.reduce((s, r) => s + f(r), 0) / rs.length : 0;

export function summarize(records: TrialRecord[], trials: number) {
  const groups = new Map<string, TrialRecord[]>();
  for (const r of records) {
    const key = `${r.model} ${r.arm}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const lines = [
    `| Model | Arm | pass^1 held | pass^${trials} held | pass^1 tune | pass^1 all | wrong tool | invalid args | extra calls | book calls | tokens in / out per task |`,
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const json: Record<string, unknown> = {};
  for (const [key, rs] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const [model, arm] = key.split(" ");
    const held = score(rs.filter((r) => r.split === "held"));
    const tune = score(rs.filter((r) => r.split === "tune"));
    const every = score(rs);
    const tokensIn = avg(
      rs,
      (r) => r.usage.input + r.usage.cacheRead + r.usage.cacheWrite,
    );
    const tokensOut = avg(rs, (r) => r.usage.output);
    lines.push(
      `| ${model} | ${arm} | ${pct(held, "pass1")} | ${pct(held, "passK")} | ${pct(tune, "pass1")} | ${pct(every, "pass1")} | ${avg(rs, (r) => r.wrongTool).toFixed(2)} | ${avg(rs, (r) => r.invalidArgs).toFixed(2)} | ${avg(rs, (r) => r.extraCalls).toFixed(2)} | ${avg(rs, (r) => r.bookCalls).toFixed(2)} | ${Math.round(tokensIn)} / ${Math.round(tokensOut)} |`,
    );
    const scopes: Record<string, Score> = {};
    for (const s of new Set(rs.map((r) => r.scope)))
      scopes[s] = score(rs.filter((r) => r.scope === s));
    json[key] = { held, tune, all: every, scopes };
  }
  return { table: lines.join("\n"), json };
}

/** Rough dollars per million tokens (input, output, cache read), for the cost estimate. */
const PRICES: Record<string, [number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
};

export function cost(records: TrialRecord[]): number {
  return records.reduce((s, r) => {
    if (r.usage.costUsd !== undefined) return s + r.usage.costUsd;
    const p = PRICES[r.model];
    if (!p) return s;
    const u = r.usage;
    return (
      s +
      ((u.input + u.cacheWrite * 1.25) * p[0] +
        u.output * p[1] +
        u.cacheRead * p[2]) /
        1e6
    );
  }, 0);
}
