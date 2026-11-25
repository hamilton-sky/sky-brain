// In-process MCP client for the bench: sky-brain's real MCP server (mcpServerFactory) on a test
// PGlite, called through createMcpHandler's fetch with a fixed agent actor. No OAuth, no network.
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Actor } from "@sky-brain/shared/actor";
import type { Db } from "../../apps/server/src/testing/harness.ts";
import { mcpServerFactory } from "../../apps/server/src/mcp/server.ts";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface ToolAnswer {
  isError: boolean;
  text: string;
}

export interface McpClient {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolAnswer>;
}

let rpcId = 0;

export function mcpClient(db: Db, actor: Actor, now?: () => Date): McpClient {
  const handler = createMcpHandler(
    mcpServerFactory(db, {
      ...(now ? { now } : {}),
      publicUrl: "http://localhost:3000",
    }),
  );
  async function rpc(method: string, params: Record<string, unknown>) {
    const request = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    const res = await handler.fetch(request, {
      authInfo: {
        token: "",
        clientId: "https://bench.test/client.json",
        scopes: ["brain:read", "brain:write"],
        extra: { actor },
      },
    });
    const text = await res.text();
    const data = text.trim().startsWith("{")
      ? [text]
      : text
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .filter(Boolean);
    const answer = JSON.parse(data[data.length - 1] ?? "null") as {
      result?: Record<string, unknown>;
      error?: { message: string };
    } | null;
    if (!answer || answer.error)
      throw new Error(`${method}: ${answer?.error?.message ?? text}`);
    return answer.result!;
  }
  return {
    async listTools() {
      const result = await rpc("tools/list", {});
      return result.tools as McpTool[];
    },
    async callTool(name, args) {
      const result = (await rpc("tools/call", { name, arguments: args })) as {
        isError?: boolean;
        content?: { type: string; text?: string }[];
      };
      const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
      return { isError: result.isError ?? false, text };
    },
  };
}
