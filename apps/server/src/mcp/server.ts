// The MCP server factory: one fresh McpServer per request (createMcpHandler), with the tools
// the caller may use: whoami, the board tools (board-tools.ts), the memory tools
// (memory-tools.ts) and the approval tools (approval-tools.ts), bound to the caller's actor.
import { ActorSchema } from "@sky-brain/shared/actor";
import {
  McpServer,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import type { Db } from "@sky-brain/db/client";
import { createRateLimiter, type RateLimiter } from "../guards/ratelimit.ts";
import type { Push } from "../push/push.ts";
import { registerApprovalTools } from "./approval-tools.ts";
import { boardDispatcher } from "./board-dispatch.ts";
import { registerBoardTools } from "./board-tools.ts";
import { registerMemoryTools } from "./memory-tools.ts";
import { registerWhoami } from "./whoami.ts";

export interface McpServerOptions {
  now?: () => Date;
  /** The board-write limiter; `createApp` passes the one its REST routes use. */
  limiter?: RateLimiter;
  /** The origin approval links point at. Default: `http://localhost:3000`. */
  publicUrl?: string;
  /** Alerts for approval requests. Default: none. */
  push?: Push;
}

export function mcpServerFactory(db: Db, options: McpServerOptions = {}) {
  const now = options.now ?? (() => new Date());
  const limiter =
    options.limiter ?? createRateLimiter({ now: () => now().getTime() });
  const board = boardDispatcher({
    db,
    now,
    limiter,
    ...(options.push ? { push: options.push } : {}),
  });
  return (ctx: McpRequestContext): McpServer => {
    // route.ts only calls the handler with a verified actor; check it again rather than trust it.
    const actor = ActorSchema.parse(ctx.authInfo?.extra?.actor);
    const server = new McpServer({ name: "sky-brain", version: "0.0.0" });
    registerWhoami(server, db, actor);
    const call = board.forActor(actor);
    registerBoardTools(server, call);
    registerMemoryTools(server, call);
    registerApprovalTools(
      server,
      call,
      options.publicUrl ?? "http://localhost:3000",
    );
    return server;
  };
}
