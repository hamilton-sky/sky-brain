// Test harness (spec.md Interfaces -> How a test reaches the server). Seeds insert rows
// directly, bypassing the trust rules and guards: tests only.
import type {
  AuthorKind,
  Kind,
  Role,
  Source,
  Status,
} from "@sky-brain/shared/enums";
import { normalizeGitRemote } from "@sky-brain/shared/git-remote";
import { closeDb, createPgliteDb, migrateDb, type Db } from "../db/client.ts";
import {
  entries,
  features,
  members,
  projects,
  workspaces,
} from "../db/schema.ts";

export type { Db };

/** A fresh in-memory PGlite with every migration applied. */
export async function createTestDb(): Promise<Db> {
  const db = await createPgliteDb();
  await migrateDb(db);
  return db;
}

export function closeTestDb(db: Db): Promise<void> {
  return closeDb(db);
}

export async function seedWorkspace(
  db: Db,
  opts: { name: string; members?: { userId: string; role: Role }[] },
): Promise<{ id: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: opts.name })
    .returning({ id: workspaces.id });
  const id = ws!.id;
  if (opts.members?.length) {
    await db
      .insert(members)
      .values(opts.members.map((m) => ({ workspaceId: id, ...m })));
  }
  return { id };
}

export async function seedProject(
  db: Db,
  opts: { workspaceId: string; slug: string; name: string; gitRemote?: string },
): Promise<{ id: string; gitRemote: string | null }> {
  let gitRemote: string | null = null;
  if (opts.gitRemote !== undefined) {
    gitRemote = normalizeGitRemote(opts.gitRemote);
    if (gitRemote === null) {
      throw new Error(
        `seedProject: cannot normalize git remote "${opts.gitRemote}"`,
      );
    }
  }
  const [row] = await db
    .insert(projects)
    .values({
      workspaceId: opts.workspaceId,
      slug: opts.slug,
      name: opts.name,
      gitRemote,
    })
    .returning({ id: projects.id, gitRemote: projects.gitRemote });
  return row!;
}

export async function seedFeature(
  db: Db,
  opts: { projectId: string; slug: string; name: string },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(features)
    .values(opts)
    .returning({ id: features.id });
  return row!;
}

export interface SeedEntry {
  workspaceId: string;
  projectId?: string;
  featureId?: string;
  kind: Kind;
  status: Status;
  title: string;
  body: string;
  /** Default `human`. */
  authorKind?: AuthorKind;
  /** Default `seed-user`. */
  author?: string;
  /** Default: the author for a human, `seed-user` for an agent. */
  onBehalfOf?: string;
  /** Default: the author kind. */
  source?: Source;
  supersedes?: string;
  replyTo?: string;
  expiresAt?: Date;
  allowAgentAnswers?: boolean;
  quarantinedBecause?: string;
}

export async function seedEntry(
  db: Db,
  opts: SeedEntry,
): Promise<{ id: string; seq: number }> {
  const authorKind = opts.authorKind ?? "human";
  const author = opts.author ?? "seed-user";
  const [row] = await db
    .insert(entries)
    .values({
      workspaceId: opts.workspaceId,
      projectId: opts.projectId ?? null,
      featureId: opts.featureId ?? null,
      kind: opts.kind,
      status: opts.status,
      title: opts.title,
      body: opts.body,
      authorKind,
      author,
      onBehalfOf:
        opts.onBehalfOf ?? (authorKind === "human" ? author : "seed-user"),
      source: opts.source ?? authorKind,
      supersedes: opts.supersedes ?? null,
      replyTo: opts.replyTo ?? null,
      expiresAt: opts.expiresAt ?? null,
      allowAgentAnswers: opts.allowAgentAnswers ?? false,
      quarantinedBecause: opts.quarantinedBecause ?? null,
    })
    .returning({ id: entries.id, seq: entries.seq });
  return row!;
}
