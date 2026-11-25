// What a trial leaves behind, and the helpers graders use to read it: the database (the main
// evidence), the tool calls the model made, and its final answer.
import { sql, type SQL } from "drizzle-orm";
import type { McpClient, ToolAnswer } from "./mcp.ts";
import type { Fixture } from "./seed.ts";

export interface Call {
  name: string;
  args: Record<string, unknown>;
  isError: boolean;
  text: string;
}

export interface Trace {
  calls: Call[];
  answer: string;
}

/** Wraps a client so every call is recorded in `calls`. */
export function recording(client: McpClient, calls: Call[]): McpClient {
  return {
    instructions: () => client.instructions(),
    listTools: () => client.listTools(),
    async callTool(name, args): Promise<ToolAnswer> {
      const answer = await client
        .callTool(name, args)
        .catch((e: unknown): ToolAnswer => ({
          isError: true,
          text: e instanceof Error ? e.message : String(e),
        }));
      calls.push({ name, args, ...answer });
      return answer;
    },
  };
}

export async function rows<T = Record<string, unknown>>(
  fx: Fixture,
  query: SQL,
): Promise<T[]> {
  const result: unknown = await fx.db.execute(query);
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

/** Entries the bench agent wrote during the trial. */
export function agentEntries(fx: Fixture) {
  return rows<{
    id: string;
    layer: string;
    kind: string;
    trust: string;
    title: string;
    body: string;
    summary: string;
    source: string;
    refs: string[] | null;
    topic: string | null;
  }>(
    fx,
    sql`select id, layer, kind, trust, title, body, summary, source, refs, topic from entries
        where workspace_id = ${fx.workspaceId} and author = 'mcp/bench.test'
        and id <> ${fx.entries.agentNote}`,
  );
}

export function task(fx: Fixture, id: string) {
  return rows<{
    status: string;
    attempts: number;
    holder_actor: string | null;
    proof: unknown;
    fail_reason: string | null;
  }>(
    fx,
    sql`select status, attempts, holder_actor, proof, fail_reason from tasks where id = ${id}`,
  ).then((r) => r[0]!);
}

export function taskEventKinds(fx: Fixture, id: string) {
  return rows<{ kind: string }>(
    fx,
    sql`select kind from task_events where task_id = ${id} order by seq`,
  ).then((r) => r.map((x) => x.kind));
}

/** A grader returns null for a pass, or why it failed. */
export type Verdict = string | null;

export function all(...checks: [boolean, string][]): Verdict {
  const failed = checks.filter(([ok]) => !ok).map(([, why]) => why);
  return failed.length ? failed.join("; ") : null;
}

export const said = (t: Trace, re: RegExp) => re.test(t.answer);
export const called = (
  t: Trace,
  name: string,
  where?: (args: Record<string, unknown>) => boolean,
) =>
  t.calls.some(
    (c) => c.name === name && !c.isError && (!where || where(c.args)),
  );
