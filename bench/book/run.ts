// The brain-book bench (BOOK.md sections 10 and 11, step 0). See README.md.
//
//   pnpm bench:book --dry                 check every grader against its gold run; no model
//   pnpm bench:book --tokens              size of the tool definitions per arm
//   pnpm bench:book --arms A,B,C,D --models claude-opus-5-5,claude-haiku-5-5 --trials 3
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runTrial, systemPrompt } from "./agent.ts";
import { runClaudeCode } from "./claude-code.ts";
import { ARM_PARTS, ARMS, type Arm, type ArmId } from "./arms.ts";
import { recording, type Call, type Trace } from "./grade.ts";
import { mcpClient, type McpTool } from "./mcp.ts";
import { cost, summarize, type TrialRecord } from "./report.ts";
import { AGENT, NOW, seedBrain } from "./seed.ts";
import { TASKS } from "./tasks.ts";

const { values: opt } = parseArgs({
  options: {
    dry: { type: "boolean", default: false },
    tokens: { type: "boolean", default: false },
    arms: { type: "string", default: "A,B,C,D" },
    models: { type: "string", default: "claude-opus-5-5" },
    trials: { type: "string", default: "3" },
    split: { type: "string", default: "all" },
    tasks: { type: "string" },
    concurrency: { type: "string", default: "4" },
    label: { type: "string" },
    "base-url": { type: "string", default: "https://api.anthropic.com" },
    via: { type: "string", default: "api" },
    set: { type: "string", default: "core" },
  },
});

/** A fresh test brain behind the arm's server variant. Gold runs use D, which has every tool. */
async function fresh(id: ArmId = "D") {
  const fx = await seedBrain();
  const mcp = mcpClient(fx.db, AGENT, ARM_PARTS[id], () => NOW);
  const instructions = await mcp.instructions();
  const arm: Arm = {
    id,
    tools: await mcp.listTools(),
    ...(instructions ? { instructions } : {}),
  };
  return { fx, mcp, tools: arm.tools, arm };
}

const selected = TASKS.filter(
  (t) =>
    (opt.set === "all" || t.set === opt.set) &&
    (opt.split === "all" || t.split === opt.split) &&
    (!opt.tasks || opt.tasks.split(",").includes(t.id)),
);

/** Runs every gold path; returns the tools and call count each used. */
async function goldRuns(check: boolean) {
  const gold = new Map<string, { tools: Set<string>; calls: number }>();
  let bad = 0;
  for (const t of selected) {
    const run = await fresh();
    const calls: Call[] = [];
    const answer = await t.gold(recording(run.mcp, calls), run.fx);
    gold.set(t.id, {
      tools: new Set(calls.map((c) => c.name)),
      calls: calls.length,
    });
    if (!check) continue;
    const ok = await t.check(run.fx, { calls, answer });
    const empty = await fresh();
    const none = await t.check(empty.fx, { calls: [], answer: "" });
    const line = `${ok === null ? "ok  " : "FAIL"} gold  ${none !== null ? "ok  " : "FAIL"} empty  ${t.split.padEnd(4)} ${t.scope.padEnd(9)} ${t.id}`;
    console.log(
      ok === null && none !== null
        ? line
        : `${line}\n      gold: ${ok ?? "-"}\n      empty: passed`,
    );
    if (ok !== null || none === null) bad++;
  }
  return { gold, bad };
}

function sizeOf(tools: McpTool[], instructions = "") {
  const chars = JSON.stringify(tools).length + instructions.length;
  return { tools: tools.length, chars, estTokens: Math.round(chars / 3.5) };
}

async function tokens() {
  const key = process.env.ANTHROPIC_API_KEY;
  const client = key
    ? new Anthropic({ apiKey: key, baseURL: opt["base-url"] })
    : undefined;
  for (const id of ARMS) {
    const { arm, mcp } = await fresh(id);
    const s = sizeOf(arm.tools, arm.instructions);
    let counted = "";
    if (client) {
      const model = opt.models.split(",")[0]!;
      const msg = [{ role: "user" as const, content: "hi" }];
      const bare = await client.messages.countTokens({ model, messages: msg });
      const full = await client.messages.countTokens({
        model,
        messages: msg,
        system: systemPrompt(arm),
        tools: arm.tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
        })),
      });
      counted = `, ${full.input_tokens - bare.input_tokens} tokens counted on ${model}`;
    }
    console.log(
      `arm ${id}: ${s.tools} tools, ${s.chars} characters, about ${s.estTokens} tokens${counted}`,
    );
    if (arm.instructions)
      console.log(
        `  server instructions: ${arm.instructions.length} characters (limit 512)`,
      );
    if (arm.tools.some((t) => t.name === "book")) {
      const contents = (await mcp.callTool("book", {})).text;
      console.log(
        `  book contents: ${contents.length} characters, about ${Math.round(contents.length / 3.5)} tokens`,
      );
    }
  }
}

async function pool<T>(
  items: T[],
  n: number,
  work: (item: T) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) await work(items[next++]!);
    }),
  );
}

/** How a trial reaches a model: the API with a key, or Claude Code with the person's sign-in. */
function trialRunner(): typeof runClaudeCode {
  if (opt.via === "claude-code") return runClaudeCode;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    throw new Error(
      "Set ANTHROPIC_API_KEY, or use --via claude-code (or --dry / --tokens).",
    );
  const client = new Anthropic({
    apiKey: key,
    baseURL: opt["base-url"],
    maxRetries: 4,
  });
  return (model, arm, mcp, calls, prompt) =>
    runTrial(client, model, arm, mcp, calls, prompt);
}

async function bench() {
  const runOne = trialRunner();
  const { gold } = await goldRuns(false);
  const arms = opt.arms.split(",") as ArmId[];
  const models = opt.models.split(",");
  const trials = Number(opt.trials);
  const jobs = models.flatMap((model) =>
    arms.flatMap((arm) =>
      selected.flatMap((task) =>
        Array.from({ length: trials }, (_, trial) => ({
          model,
          arm,
          task,
          trial,
        })),
      ),
    ),
  );
  console.log(
    `${jobs.length} trials: ${models.join(", ")} x arms ${arms.join("")} x ${selected.length} tasks x ${trials}`,
  );
  const records: TrialRecord[] = [];
  await pool(
    jobs,
    Number(opt.concurrency),
    async ({ model, arm: armId, task, trial }) => {
      const run = await fresh(armId);
      const arm = run.arm;
      const calls: Call[] = [];
      const result = await runOne(
        model,
        arm,
        recording(run.mcp, calls),
        calls,
        task.prompt(run.fx),
      );
      const trace: Trace = { calls, answer: result.answer };
      const why = await task.check(run.fx, trace);
      const g = gold.get(task.id)!;
      const writes = new Set(
        run.tools
          .filter((t) => t.annotations?.readOnlyHint !== true)
          .map((t) => t.name),
      );
      const real = calls.filter((c) => c.name !== "book");
      records.push({
        model,
        arm: armId,
        task: task.id,
        split: task.split,
        scope: task.scope,
        trial,
        pass: why === null,
        why,
        calls: calls.map((c) => ({ name: c.name, isError: c.isError })),
        wrongTool: real.filter(
          (c) =>
            c.text.startsWith("Unknown tool") ||
            (writes.has(c.name) && !g.tools.has(c.name)),
        ).length,
        invalidArgs: real.filter(
          (c) =>
            c.isError && /invalid|validation|required|expected/i.test(c.text),
        ).length,
        extraCalls: Math.max(0, real.length - g.calls),
        bookCalls: calls.length - real.length,
        usage: result.usage,
        stop: result.stop,
        answer: result.answer,
      });
      process.stdout.write(why === null ? "." : "x");
    },
  );
  console.log("\n");
  const { table, json } = summarize(records, trials);
  console.log(table);
  console.log(`\nAbout $${cost(records).toFixed(2)} spent.`);
  const dir = join(import.meta.dirname, "results");
  mkdirSync(dir, { recursive: true });
  const label =
    opt.label ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  writeFileSync(
    join(dir, `${label}.json`),
    JSON.stringify({ trials, summary: json, records }, null, 2),
  );
  console.log(`Wrote results/${label}.json`);
}

if (opt.dry) {
  const { bad } = await goldRuns(true);
  console.log(
    `\n${selected.length - bad} of ${selected.length} graders pass their gold run and fail an empty one.`,
  );
  process.exitCode = bad ? 1 : 0;
} else if (opt.tokens) {
  await tokens();
} else {
  await bench();
}
