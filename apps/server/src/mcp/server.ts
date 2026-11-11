// The MCP server factory: one fresh McpServer per request (createMcpHandler), with the tools
// the caller may use. Later tickets add the Layer 1 tools here.
import { ActorSchema } from "@sky-brain/shared/actor";
import {
  McpServer,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import type { Db } from "../db/client.ts";
import { registerWhoami } from "./whoami.ts";

export function mcpServerFactory(db: Db, now: () => Date = () => new Date()) {
  return (ctx: McpRequestContext): McpServer => {
    // route.ts only calls the handler with a verified actor; check it again rather than trust it.
    const actor = ActorSchema.parse(ctx.authInfo?.extra?.actor);
    const server = new McpServer({ name: "sky-brain", version: "0.0.0" });
    registerWhoami(server, db, actor);
    return server;
  };
}
