// The shape of one bench task. `gold` is a known-good run, used by `--dry` to prove each grader
// passes a right answer and fails an empty one, without calling a model.
import type { Trace, Verdict } from "./grade.ts";
import type { McpClient } from "./mcp.ts";
import type { Fixture } from "./seed.ts";

export type Scope =
  "about-me" | "notebooks" | "inbox" | "board" | "across" | "approval";

export interface BenchTask {
  id: string;
  /** Which part of the brain the task exercises (BOOK.md section 13). */
  scope: Scope;
  /** The trap the task sets, if any: similar tools, a refusal, a missing argument. */
  trap?: string;
  prompt(fx: Fixture): string;
  gold(c: McpClient, fx: Fixture): Promise<string>;
  check(fx: Fixture, t: Trace): Promise<Verdict> | Verdict;
}

/** Calls a tool and parses its JSON answer; throws on a tool error (gold runs only). */
export async function json<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
  c: McpClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const r = await c.callTool(name, args);
  if (r.isError) throw new Error(`${name}: ${r.text}`);
  return JSON.parse(r.text) as T;
}
