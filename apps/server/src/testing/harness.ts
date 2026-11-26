// Test harness (spec.md Interfaces -> How a test reaches the server). Seeds insert rows
// directly, bypassing the trust rules and guards: tests only.
import type { Semantic } from "@sky-brain/memory/embed/semantic";
import type { Push } from "@sky-brain/approvals/push/push";
import type { AuthorKind, Role } from "@sky-brain/shared/enums";
import type {
  EntryTopic,
  KnowledgeKind,
  MemoryLayer,
  TrustLevel,
} from "@sky-brain/shared/memory";
import { and, eq } from "drizzle-orm";
import type { Actor } from "@sky-brain/shared/actor";
import { normalizeGitRemote } from "@sky-brain/shared/git-remote";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ActorResolver } from "@sky-brain/kernel/actor/middleware";
import { createApp } from "../app.ts";
import type { Db } from "@sky-brain/db/client";
import {
  entries,
  entryVersions,
  features,
  members,
  memories,
  projects,
  workspaces,
} from "@sky-brain/db/schema";
import { createDefaultMemories } from "@sky-brain/memory/memories";

export type { Db };

// createTestDb lives in packages/db; re-exported so existing tests and bench/ keep working.
export { closeTestDb, createTestDb } from "@sky-brain/db/test-db";

export async function seedWorkspace(
  db: Db,
  opts: { name: string; members?: { userId: string; role: Role }[] },
): Promise<{ id: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: opts.name })
    .returning({ id: workspaces.id });
  const id = ws!.id;
  // Like a sign-in: About me, the default Inbox and the default Notebook.
  await createDefaultMemories(db, id);
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
  /** Default: the workspace's default memory of `layer`. */
  memoryId?: string;
  /** Default `short` (the Inbox). */
  layer?: MemoryLayer;
  kind?: KnowledgeKind;
  topic?: EntryTopic;
  trust?: TrustLevel;
  title: string;
  body: string;
  summary?: string;
  /** Default `human`. */
  authorKind?: AuthorKind;
  /** Default `seed-user`. */
  author?: string;
  expiresAt?: Date;
}

/** One entry and its first version, inserted directly: no trust rules, no guards. */
export async function seedEntry(
  db: Db,
  opts: SeedEntry,
): Promise<{ id: string; memoryId: string }> {
  const layer = opts.layer ?? "short";
  let memoryId = opts.memoryId;
  if (memoryId === undefined) {
    const [m] = await db
      .select({ id: memories.id })
      .from(memories)
      .where(
        and(
          eq(memories.workspaceId, opts.workspaceId),
          eq(memories.layer, layer),
          eq(memories.isDefault, true),
        ),
      );
    memoryId = m!.id;
  }
  const authorKind = opts.authorKind ?? "human";
  const author = opts.author ?? "seed-user";
  const summary = opts.summary ?? opts.title;
  const kind = opts.kind ?? "fact";
  const [row] = await db
    .insert(entries)
    .values({
      workspaceId: opts.workspaceId,
      memoryId,
      layer,
      kind,
      topic: opts.topic ?? null,
      trust: opts.trust ?? "approved",
      title: opts.title,
      body: opts.body,
      summary,
      summarySource: "writer",
      authorKind,
      author,
      onBehalfOf: author,
      source: authorKind,
      quarantinedBecause: opts.trust === "quarantined" ? "seed" : null,
      expiresAt:
        layer === "short"
          ? (opts.expiresAt ?? new Date(Date.now() + 86_400_000))
          : null,
    })
    .returning({ id: entries.id });
  await db.insert(entryVersions).values({
    entryId: row!.id,
    version: 1,
    kind,
    topic: opts.topic ?? null,
    title: opts.title,
    body: opts.body,
    summary,
    summarySource: "writer",
    authorKind,
    author,
  });
  return { id: row!.id, memoryId };
}

export interface TestResponse {
  status: number;
  headers: Headers;
  /** The parsed JSON body, or null when the body is not JSON. */
  body: any;
  text: string;
}

export interface TestClient {
  get(path: string): Promise<TestResponse>;
  post(path: string, body?: unknown): Promise<TestResponse>;
  delete(path: string, body?: unknown): Promise<TestResponse>;
  request(path: string, init?: RequestInit): Promise<TestResponse>;
}

export interface TestServer {
  /** http://127.0.0.1:<port> */
  url: string;
  /** Every request carries that actor. */
  as(actor: Actor): TestClient;
  /** Requests carry no actor. */
  anonymous: TestClient;
  close(): Promise<void>;
}

export interface TestServerOptions {
  db: Db;
  now?: () => Date;
  /** Default false. */
  devActorHeader?: boolean;
  webDist?: string;
  /** Web push for approval requests. Default: off. */
  push?: Push;
  /** Hybrid search's embedder and background runner (D47). Default: words only. */
  semantic?: Semantic;
}

async function toTestResponse(res: Response): Promise<TestResponse> {
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body, text };
}

export function testClient(url: string, token: string | undefined): TestClient {
  const request = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    return toTestResponse(await fetch(url + path, { ...init, headers }));
  };
  const withBody = (method: string) => (path: string, body?: unknown) =>
    request(
      path,
      body === undefined
        ? { method }
        : {
            method,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
  return {
    get: (path) => request(path),
    post: withBody("POST"),
    delete: withBody("DELETE"),
    request,
  };
}

/**
 * The app on a free 127.0.0.1 port. `as(actor)` sends an opaque `Authorization: Bearer <random>`
 * that this harness's resolver maps back to the actor, the header real tokens will use.
 */
export async function startTestServer(
  opts: TestServerOptions,
): Promise<TestServer> {
  const actors = new Map<string, Actor>();
  const tokens = new Map<string, string>();
  const resolveActor: ActorResolver = (req) => {
    const match = /^Bearer (\S+)$/.exec(req.get("authorization") ?? "");
    return match ? actors.get(match[1]!) : undefined;
  };
  const app = createApp({
    db: opts.db,
    resolveActor,
    devActorHeader: opts.devActorHeader ?? false,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.webDist ? { webDist: opts.webDist } : {}),
    ...(opts.push ? { push: opts.push } : {}),
    ...(opts.semantic ? { semantic: opts.semantic } : {}),
  });
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1", (err?: Error) =>
      err ? reject(err) : resolve(s),
    );
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    as(actor) {
      const key = JSON.stringify(actor);
      let token = tokens.get(key);
      if (!token) {
        token = randomBytes(16).toString("hex");
        tokens.set(key, token);
        actors.set(token, actor);
      }
      return testClient(url, token);
    },
    anonymous: testClient(url, undefined),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
