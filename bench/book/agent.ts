// One trial: a Claude model with an arm's tools, a task's prompt, and a manual tool loop against
// the in-process MCP server. Returns the answer and usage; the calls are recorded by the client.
import Anthropic from "@anthropic-ai/sdk";
import type { Arm } from "./arms.ts";
import type { Call } from "./grade.ts";
import type { McpClient } from "./mcp.ts";

/** At most this many model turns per trial; a model still calling tools after that fails. */
const MAX_TURNS = 12;

export const BASE_SYSTEM =
  "You are an assistant connected to the person's sky-brain over MCP. The person is Ann; she sent the message below and is not available for follow-up questions, so do the whole request now with the tools, then give her a short final answer.";

export interface TrialUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  turns: number;
  /** What the run cost, when the client reports it (Claude Code does). */
  costUsd?: number;
}

export interface TrialResult {
  answer: string;
  usage: TrialUsage;
  stop: string;
}

function toApiTools(arm: Arm): Anthropic.Tool[] {
  return arm.tools.map((t, i) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
    // Tools and system are the same for every trial of an arm: cache them.
    ...(i === arm.tools.length - 1
      ? { cache_control: { type: "ephemeral" as const } }
      : {}),
  }));
}

export function systemPrompt(arm: Arm): string {
  return arm.instructions
    ? `${BASE_SYSTEM}\n\n<server_instructions>\n${arm.instructions}\n</server_instructions>`
    : BASE_SYSTEM;
}

export async function runTrial(
  client: Anthropic,
  model: string,
  arm: Arm,
  mcp: McpClient,
  calls: Call[],
  prompt: string,
): Promise<TrialResult> {
  const tools = toApiTools(arm);
  const system = systemPrompt(arm);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: prompt },
  ];
  const usage: TrialUsage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    turns: 0,
  };
  let answer = "";
  while (usage.turns < MAX_TURNS) {
    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      system,
      tools,
      messages,
    });
    usage.turns++;
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (text) answer = text;
    if (
      response.stop_reason === "refusal" ||
      response.stop_reason === "max_tokens"
    ) {
      return { answer, usage, stop: response.stop_reason };
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    const uses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (uses.length === 0)
      return { answer, usage, stop: response.stop_reason ?? "end_turn" };
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const args = (use.input ?? {}) as Record<string, unknown>;
      const local = await arm.local(use.name, args);
      let out: { isError: boolean; text: string };
      if (local !== undefined) {
        out = { isError: false, text: local };
        calls.push({ name: use.name, args, ...out });
      } else if (arm.tools.some((t) => t.name === use.name)) {
        out = await mcp.callTool(use.name, args).catch((e: unknown) => ({
          isError: true,
          text: String(e instanceof Error ? e.message : e),
        }));
      } else {
        out = { isError: true, text: `Unknown tool: ${use.name}` };
        calls.push({ name: use.name, args, ...out });
      }
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: out.text,
        is_error: out.isError,
      });
    }
    messages.push({ role: "user", content: results });
  }
  return { answer, usage, stop: "max_turns" };
}
