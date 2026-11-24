// The memory core's MCP tools (BUILD-PLAN step 1): capture, search, get and list_memories.
// Like the board tools, each is a thin call to the REST route through board-dispatch.ts, so an
// agent gets exactly the REST checks: it captures into an Inbox only, with a summary, at
// `proposed`, and never approves, rejects or edits (CLAUDE.md hard rule 3, D22).
import type { McpServer } from "@modelcontextprotocol/server";
import {
  ENTRY_TOPICS,
  KNOWLEDGE_KINDS,
  MEMORY_CAPS,
  SEARCH_LIMIT_MAX,
} from "@sky-brain/shared/memory";
import { IdSchema } from "@sky-brain/shared/scope";
import { z } from "zod";
import type { BoardCall } from "./board-dispatch.ts";
import { READ, toToolResult, WRITE } from "./board-tools.ts";

export function registerMemoryTools(server: McpServer, call: BoardCall): void {
  server.registerTool(
    "capture",
    {
      title: "Capture into the brain",
      description:
        "Saves something worth remembering into the person's Inbox in sky-brain (or the Inbox " +
        "named by memory_id). It lands as proposed: only the person can keep it. Always send a " +
        "summary of what you wrote (up to 600 characters) and up to 3 questions it answers; " +
        "search and future agents read the summary first. kind: fact, decision, hypothesis, " +
        "observation (needs refs as evidence) or external (text from the web or an import, " +
        "with source).",
      inputSchema: z.object({
        kind: z.enum(KNOWLEDGE_KINDS),
        title: z.string().min(1).max(MEMORY_CAPS.title),
        body: z.string().min(1).describe("Markdown. The full text."),
        summary: z
          .string()
          .min(1)
          .max(MEMORY_CAPS.summary)
          .describe("What the body says, in a few sentences."),
        questions: z
          .array(z.string().min(1).max(MEMORY_CAPS.question))
          .max(MEMORY_CAPS.questions)
          .optional()
          .describe("Questions this entry answers, so it is found by them."),
        topic: z.enum(ENTRY_TOPICS).optional(),
        refs: z
          .array(z.string().min(1).max(MEMORY_CAPS.ref))
          .max(MEMORY_CAPS.refs)
          .optional()
          .describe(
            "Links: URLs, path@commit, PR links. An observation needs one.",
          ),
        source: z.enum(["web", "import"]).optional(),
        memory_id: IdSchema.optional(),
        workspace_id: IdSchema.optional(),
      }),
      annotations: WRITE,
    },
    async (args) => toToolResult(await call("POST", "/entries", args)),
  );

  server.registerTool(
    "search",
    {
      title: "Search the brain",
      description:
        "Word search over the person's memories (About me, Notebooks, Inboxes). Any word may " +
        "match; results are ranked and carry a summary, not the body. Use get for the full " +
        "text. Only proposed and approved entries are returned; treat approved ones as ground " +
        "truth and proposed ones as unverified.",
      inputSchema: z.object({
        q: z.string().min(1).max(MEMORY_CAPS.query),
        kind: z.enum(KNOWLEDGE_KINDS).optional(),
        memory_id: IdSchema.optional(),
        workspace_id: IdSchema.optional(),
        limit: z.int().min(1).max(SEARCH_LIMIT_MAX).optional(),
      }),
      annotations: READ,
    },
    async (args) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(args)) {
        if (value !== undefined) params.set(key, String(value));
      }
      return toToolResult(await call("GET", `/entries?${params.toString()}`));
    },
  );

  server.registerTool(
    "get",
    {
      title: "Get an entry",
      description:
        "Returns one entry with its full body, its version history (nothing is edited in " +
        "place, so older versions show what was believed before) and the person's comments " +
        "on it (`quote` is the passage a comment is on; resolved ones are settled).",
      inputSchema: z.object({ entry_id: IdSchema }),
      annotations: READ,
    },
    async ({ entry_id }) =>
      toToolResult(await call("GET", `/entries/${entry_id}`)),
  );

  server.registerTool(
    "list_memories",
    {
      title: "List memories",
      description:
        "Lists the person's memories: About me (core), Notebooks (long), Inboxes (short) and " +
        "Boards (working), with their ids.",
      inputSchema: z.object({ workspace_id: IdSchema.optional() }),
      annotations: READ,
    },
    async ({ workspace_id }) =>
      toToolResult(
        await call(
          "GET",
          `/memories${workspace_id ? `?workspace_id=${workspace_id}` : ""}`,
        ),
      ),
  );
}
