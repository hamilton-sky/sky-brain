// Two people, each with their own brain: alice (and her agent) in workspace "a", bob in "b".
// The memory tests read across them to prove one brain never answers for another (rule 4).
import type { Actor } from "@sky-brain/shared/actor";
import type { Db } from "@sky-brain/db/client";
import { seedWorkspace } from "./harness.ts";

export const alice: Actor = { kind: "human", user_id: "alice" };
export const aliceAgent: Actor = {
  kind: "agent",
  agent_id: "mcp/claude.ai",
  on_behalf_of: "alice",
};
export const bob: Actor = { kind: "human", user_id: "bob" };

/** Seeds both workspaces; returns alice's. */
export async function seedTwoBrains(db: Db): Promise<string> {
  const a = await seedWorkspace(db, {
    name: "a",
    members: [{ userId: "alice", role: "owner" }],
  });
  await seedWorkspace(db, {
    name: "b",
    members: [{ userId: "bob", role: "owner" }],
  });
  return a.id;
}
