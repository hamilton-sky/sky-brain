// The bearer-JWT ActorResolver for /mcp only (spec.md Decisions -> What actor an MCP token
// yields): an agent `mcp/<client host>` acting for the token's subject, so `requireHuman`
// refuses MCP callers (CLAUDE.md hard rule 3) and `personOf` still gives the person.
import { ActorSchema, type Actor } from "@sky-brain/shared/actor";

/** The verified claims of an access token; undefined when they do not name a person and client. */
export function actorFromMcpClaims(
  claims: Record<string, unknown>,
): Actor | undefined {
  const { sub, azp } = claims;
  if (typeof sub !== "string" || typeof azp !== "string") return undefined;
  let client: URL;
  try {
    client = new URL(azp);
  } catch {
    return undefined;
  }
  if (client.protocol !== "https:") return undefined;
  const parsed = ActorSchema.safeParse({
    kind: "agent",
    agent_id: `mcp/${client.hostname.toLowerCase()}`,
    on_behalf_of: sub,
  });
  return parsed.success ? parsed.data : undefined;
}
