// Everyday actions an agent does for its person (D45): create and rename a project, and comment
// on an entry. Each is a thin call to the REST route through board-dispatch.ts, so the agent gets
// exactly the person's checks (owner or editor; another workspace is 404). Approving, rejecting,
// releasing, deleting, rules, About me and sharing stay with people (CLAUDE.md hard rule 3).
import type { McpServer } from "@modelcontextprotocol/server";
import { CommentCreateRequestSchema } from "@sky-brain/shared/comments";
import { ProjectRenameRequestSchema } from "@sky-brain/shared/projects";
import { IdSchema } from "@sky-brain/shared/scope";
import { z } from "zod";
import type { BoardCall } from "./board-dispatch.ts";
import { toToolResult, WRITE } from "./board-tools.ts";
import { hatArg, type CallFor } from "./hat-lens.ts";

const name = ProjectRenameRequestSchema.shape.name;

/** Projects are not hat-scoped (`call`); a comment reaches an entry through the hat lens (D44). */
export function registerEverydayTools(
  server: McpServer,
  call: BoardCall,
  callFor: CallFor,
): void {
  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description:
        "Creates a project in one of the person's workspaces, where they are an owner or " +
        "editor. The slug comes from the name. Returns the project with its id.",
      inputSchema: z.object({ workspace_id: IdSchema, name }),
      annotations: WRITE,
    },
    async (args) => toToolResult(await call("POST", "/projects", args)),
  );

  server.registerTool(
    "rename_project",
    {
      title: "Rename a project",
      description:
        "Changes a project's display name. The slug and everything in the project stay.",
      inputSchema: z.object({ project_id: IdSchema, name }),
      annotations: WRITE,
    },
    async ({ project_id, ...body }) =>
      toToolResult(await call("POST", `/projects/${project_id}/rename`, body)),
  );

  server.registerTool(
    "comment",
    {
      title: "Comment on an entry",
      description:
        "Adds a comment to an entry (a document, note or Inbox item), marked as yours. " +
        "quote is the passage it is about; leave it out for a general note. Only the " +
        "person resolves or deletes comments.",
      inputSchema: z.object({
        entry_id: IdSchema,
        ...CommentCreateRequestSchema.shape,
        hat: hatArg,
      }),
      annotations: WRITE,
    },
    async ({ entry_id, hat, ...body }) =>
      toToolResult(
        await (
          await callFor(hat)
        )("POST", `/entries/${entry_id}/comments`, body),
      ),
  );
}
