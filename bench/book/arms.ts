// The arms (BOOK.md section 10), each one a variant of sky-brain's real MCP server, so the bench
// measures exactly what would ship (`McpServerOptions.book`):
//   A  today's tools, as the live server lists them
//   B  the same tools with "Use when" and "Pitfalls" in each description
//   C  B plus `context { q }`, the cross-layer packet
//   D  C plus the server instructions and `book { id? }` with a live "Your brain now"
// Until 25 Nov the bench had three arms and C meant "B plus the book" (no context); see README.
import type { McpTool } from "./mcp.ts";

export type ArmId = "A" | "B" | "C" | "D";
export const ARMS: ArmId[] = ["A", "B", "C", "D"];

export interface BookParts {
  guides: boolean;
  book: boolean;
  context: boolean;
}

export const ARM_PARTS: Record<ArmId, BookParts> = {
  A: { guides: false, book: false, context: false },
  B: { guides: true, book: false, context: false },
  C: { guides: true, book: false, context: true },
  D: { guides: true, book: true, context: true },
};

export interface Arm {
  id: ArmId;
  tools: McpTool[];
  /** Server instructions from `initialize`, if the arm has any. */
  instructions?: string;
}
