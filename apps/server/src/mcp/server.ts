// The MCP server factory: one fresh McpServer per request (createMcpHandler), with the tools
// the caller may use: whoami, and the board tools (board-tools.ts) bound to the caller's actor.
import { ActorSchema } from "@sky-brain/shared/actor";
import {
  McpServer,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import type { Db } from "../db/client.ts";
import { createRateLimiter, type RateLimiter } from "../guards/ratelimit.ts";
import { boardDispatcher } from "./board-dispatch.ts";
import { registerBoardTools } from "./board-tools.ts";
import { registerWhoami } from "./whoami.ts";

export interface McpServerOptions {
  now?: () => Date;
  /** The board-write limiter; `createApp` passes the one its REST routes use. */
  limiter?: RateLimiter;
}

export function mcpServerFactory(db: Db, options: McpServerOptions = {}) {
  const now = options.now ?? (() => new Date());
  const limiter =
    options.limiter ?? createRateLimiter({ now: () => now().getTime() });
  const board = boardDispatcher({ db, now, limiter });
  return (ctx: McpRequestContext): McpServer => {
    // route.ts only calls the handler with a verified actor; check it again rather than trust it.
    const actor = ActorSchema.parse(ctx.authInfo?.extra?.actor);
    const server = new McpServer({ name: "sky-brain", version: "0.0.0" });
    registerWhoami(server, db, actor);
    registerBoardTools(server, board.forActor(actor));
    return server;
  };
}
