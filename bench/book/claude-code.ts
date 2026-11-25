// One trial through Claude Code instead of the API (`--via claude-code`): no API key, the
// person's own Claude sign-in. Each trial serves the arm's tools from a small MCP endpoint on
// localhost (streamable HTTP, JSON answers only) and runs `claude -p` against it, with no
// built-in tools and from an empty folder, so the brain's tools are all it has.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_SYSTEM, type TrialResult } from "./agent.ts";
import type { Arm } from "./arms.ts";
import type { Call } from "./grade.ts";
import type { McpClient } from "./mcp.ts";

const TIMEOUT_MS = 5 * 60_000;

interface Rpc {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    protocolVersion?: string;
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

/** The arm as an MCP server: its tools, its instructions, the book answered locally. */
function armEndpoint(arm: Arm, mcp: McpClient, calls: Call[]) {
  async function answer(rpc: Rpc): Promise<unknown> {
    switch (rpc.method) {
      case "initialize":
        return {
          protocolVersion: rpc.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "sky-brain", version: "bench" },
          ...(arm.instructions ? { instructions: arm.instructions } : {}),
        };
      case "tools/list":
        return { tools: arm.tools };
      case "tools/call": {
        const name = rpc.params?.name ?? "";
        const args = rpc.params?.arguments ?? {};
        const local = await arm.local(name, args);
        let out: { isError: boolean; text: string };
        if (local !== undefined) {
          out = { isError: false, text: local };
          calls.push({ name, args, ...out });
        } else if (arm.tools.some((t) => t.name === name)) {
          out = await mcp.callTool(name, args);
        } else {
          out = { isError: true, text: `Unknown tool: ${name}` };
          calls.push({ name, args, ...out });
        }
        return {
          content: [{ type: "text", text: out.text }],
          isError: out.isError,
        };
      }
      default:
        return {};
    }
  }
  return createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    readBody(req)
      .then(async (text) => {
        const rpc = JSON.parse(text) as Rpc;
        if (rpc.id === undefined) {
          res.writeHead(202).end(); // a notification
          return;
        }
        const result = await answer(rpc);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
      })
      .catch((e: unknown) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32603, message: String(e) },
          }),
        );
      });
  });
}

interface ClaudeJson {
  result?: string;
  is_error?: boolean;
  subtype?: string;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

function runClaude(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? "claude", args, {
      cwd,
      env: { ...process.env, ENABLE_TOOL_SEARCH: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (out.trim()) resolve(out);
      else reject(new Error(`claude exited ${code}: ${err.slice(0, 500)}`));
    });
  });
}

export async function runClaudeCode(
  model: string,
  arm: Arm,
  mcp: McpClient,
  calls: Call[],
  prompt: string,
): Promise<TrialResult> {
  const server = armEndpoint(arm, mcp, calls);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const dir = mkdtempSync(join(tmpdir(), "book-bench-"));
  try {
    const config = join(dir, "mcp.json");
    writeFileSync(
      config,
      JSON.stringify({
        mcpServers: {
          brain: { type: "http", url: `http://127.0.0.1:${port}/mcp` },
        },
      }),
    );
    const out = await runClaude(
      [
        "-p",
        prompt,
        "--model",
        model,
        "--output-format",
        "json",
        "--mcp-config",
        config,
        "--strict-mcp-config",
        "--tools",
        "",
        "--allowedTools",
        "mcp__brain",
        "--setting-sources",
        "project",
        "--no-session-persistence",
        "--append-system-prompt",
        BASE_SYSTEM,
      ],
      dir,
    );
    const j = JSON.parse(out.trim().split("\n").pop() ?? "{}") as ClaudeJson;
    const u = j.usage ?? {};
    return {
      answer: j.result ?? "",
      usage: {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        turns: j.num_turns ?? 0,
        ...(j.total_cost_usd !== undefined
          ? { costUsd: j.total_cost_usd }
          : {}),
      },
      stop: j.is_error ? (j.subtype ?? "error") : (j.subtype ?? "success"),
    };
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
