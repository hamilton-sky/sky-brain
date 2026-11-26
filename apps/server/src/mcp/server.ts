// The MCP server factory: one fresh McpServer per request (createMcpHandler), with the tools
// the caller may use: the book (book-tool.ts), whoami, the board tools (board-tools.ts), the
// memory tools (memory-tools.ts), context (context-tool.ts) and the approval tools
// (approval-tools.ts), bound to the caller's actor; each description carries its guide
// (tool-guides.ts) and the server sends short instructions that point at the book.
import { ActorSchema } from "@sky-brain/shared/actor";
import {
  McpServer,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import type { Db } from "@sky-brain/db/client";
import {
  createRateLimiter,
  type RateLimiter,
} from "@sky-brain/kernel/guards/ratelimit";
import type { Push } from "@sky-brain/approvals/push/push";
import { registerApprovalTools } from "./approval-tools.ts";
import { boardDispatcher } from "./board-dispatch.ts";
import { registerBoardTools } from "./board-tools.ts";
import { registerBookTool, serverInstructions } from "./book-tool.ts";
import { registerContextTool } from "./context-tool.ts";
import { hatLens } from "./hat-lens.ts";
import { registerMemoryTools } from "./memory-tools.ts";
import { addGuidesOnRegister } from "./tool-guides.ts";
import { registerWhoami } from "./whoami.ts";

export interface McpServerOptions {
  now?: () => Date;
  /** The board-write limiter; `createApp` passes the one its REST routes use. */
  limiter?: RateLimiter;
  /** The origin approval links point at. Default: `http://localhost:3000`. */
  publicUrl?: string;
  /** Alerts for approval requests. Default: none. */
  push?: Push;
  /**
   * The brain book's parts (BOOK.md 11 step 1), all on by default. The book bench turns them
   * off to compare arms; nothing else should.
   */
  book?: { guides?: boolean; book?: boolean; context?: boolean };
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
    const parts = { guides: true, book: true, context: true, ...options.book };
    const server = new McpServer(
      { name: "sky-brain", version: "0.0.0" },
      parts.book ? { instructions: serverInstructions(parts.context) } : {},
    );
    if (parts.guides) addGuidesOnRegister(server, parts.context);
    const call = board.forActor(actor);
    if (parts.book) registerBookTool(server, call, actor);
    registerWhoami(server, db, actor);
    registerBoardTools(server, call);
    const callFor = hatLens(db, actor, (a) => board.forActor(a));
    registerMemoryTools(server, callFor);
    if (parts.context) registerContextTool(server, callFor);
    registerApprovalTools(
      server,
      call,
      options.publicUrl ?? "http://localhost:3000",
    );
    return server;
  };
}
