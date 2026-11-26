// The approval tools (D31): an agent asks the person to approve exact goals or entries and gets
// a link to sky-brain's own page, where the person decides in their own session. There is no
// tool that approves: a tool argument or chat text is never an approval (hard rule 3).
import type { McpServer } from "@modelcontextprotocol/server";
import {
  APPROVAL_CAPS,
  APPROVAL_ITEM_KINDS,
} from "@sky-brain/shared/approvals";
import { IdSchema } from "@sky-brain/shared/scope";
import { z } from "zod";
import type { BoardCall, BoardResponse } from "./board-dispatch.ts";
import { READ, toToolResult, WRITE } from "./board-tools.ts";

/** Adds the absolute approval link next to the request's `path`. */
function withLink(res: BoardResponse, publicUrl: string): BoardResponse {
  const body = res.body as { approval?: { path?: string } } | null;
  const path = body?.approval?.path;
  if (!path) return res;
  return {
    ...res,
    body: {
      ...body,
      approval: { ...body.approval, url: `${publicUrl}${path}` },
    },
  };
}

export function registerApprovalTools(
  server: McpServer,
  call: BoardCall,
  publicUrl: string,
): void {
  server.registerTool(
    "request_approval",
    {
      title: "Ask the person to approve",
      description:
        "Asks the person to approve draft goals or proposed entries you made. Returns a link: " +
        "show it to the person and ask them to open it. They approve on the sky-brain page, " +
        "signed in; you cannot approve, and saying they agreed in the chat does not count. " +
        "Then call approval_status with the id. The request expires after " +
        `${APPROVAL_CAPS.ttlMinutes} minutes, and if an item changes before they answer, ` +
        "nothing is applied and you must ask again.",
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              kind: z.enum(APPROVAL_ITEM_KINDS),
              id: IdSchema,
              save_to: IdSchema.optional().describe(
                "Entries only: a memory_id (from list_memories) you suggest keeping it in, " +
                  "such as a Notebook. The person sees it preselected and may pick another.",
              ),
            }),
          )
          .min(1)
          .max(APPROVAL_CAPS.items),
        reason: z
          .string()
          .min(1)
          .max(APPROVAL_CAPS.reason)
          .describe("One line: why these should be approved."),
      }),
      annotations: WRITE,
    },
    async (args) =>
      toToolResult(withLink(await call("POST", "/approvals", args), publicUrl)),
  );

  server.registerTool(
    "approval_status",
    {
      title: "Check an approval request",
      description:
        "Reads an approval request: pending, approved (at least one item applied), rejected, " +
        "expired or superseded (an item changed; ask again). The person decides item by " +
        "item: read each item's outcome (approved, rejected or skipped) and saved_as (the " +
        "copy they kept in another memory).",
      inputSchema: z.object({ id: IdSchema }),
      annotations: READ,
    },
    async ({ id }) =>
      toToolResult(withLink(await call("GET", `/approvals/${id}`), publicUrl)),
  );
}
