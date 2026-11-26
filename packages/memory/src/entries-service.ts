// The memory core's write and read rules (BUILD-PLAN step 1, D22, MEMORY-SCHEMA.md § 4-5).
// Writes: agents capture into an Inbox only, with a summary, at `proposed`; people write any
// memory they may write, at `approved`; About me is the owner's alone; web or instruction-like
// text is `quarantined`; nothing is edited in place (a change is a new version). Only a person
// approves, rejects or revises. Reads hide quarantined and rejected entries from agents.
import type { Actor } from "@sky-brain/shared/actor";
import type { Role } from "@sky-brain/shared/enums";
import {
  fallbackSummary,
  INBOX_TTL_DAYS,
  type CaptureRequest,
  type ReviseRequest,
  type TrustLevel,
} from "@sky-brain/shared/memory";
import { and, asc, eq } from "drizzle-orm";
import { auditActor, personOf } from "@sky-brain/kernel/actor/keys";
import { writeAudit } from "@sky-brain/db/audit";
import type { Db, DbOrTx } from "@sky-brain/db/client";
import { entries, entryVersions, members } from "@sky-brain/db/schema";
import { HttpError } from "@sky-brain/kernel/http/http-error";
import {
  heldBecause,
  refuseSecrets,
} from "@sky-brain/kernel/guards/write-guards";
import { detectInjection } from "@sky-brain/kernel/guards/quarantine";
import {
  defaultMemory,
  findMemory,
  ownWorkspace,
  workspaceRoles,
  type MemoryRow,
} from "./memories.ts";
import { coreEntryInHat } from "./hat-reach.ts";

export type EntryRow = typeof entries.$inferSelect;
export type VersionRow = typeof entryVersions.$inferSelect;

/** Trust levels an agent may ever read. */
export const AGENT_READABLE: TrustLevel[] = ["proposed", "approved"];

function isWriter(role: Role): boolean {
  return role === "owner" || role === "editor";
}

/** Owner and editor write; About me only the owner, in person. */
function assertMayWrite(actor: Actor, memory: MemoryRow, role: Role): void {
  if (!isWriter(role)) {
    throw new HttpError(403, "role_cannot_write", "A viewer cannot write.");
  }
  if (memory.layer === "core" && (actor.kind !== "human" || role !== "owner")) {
    throw new HttpError(
      403,
      "core_owner_only",
      "Only the owner, in person, writes About me.",
    );
  }
}

/** Why the text is held, or undefined: web text always, instruction-like text anywhere. */
function quarantineReason(
  source: string,
  fields: { title: string; body: string; summary: string; questions: string[] },
): string | undefined {
  if (source === "web") return "web_source";
  return (
    heldBecause(fields.title, fields.body) ??
    detectInjection(fields.summary) ??
    fields.questions.map((q) => detectInjection(q)).find((r) => r !== undefined)
  );
}

function refuseSecretsIn(fields: {
  title: string;
  body: string;
  summary?: string;
  questions?: string[];
  refs?: string[];
}): void {
  refuseSecrets([
    { name: "title", value: fields.title },
    { name: "body", value: fields.body },
    ...(fields.summary === undefined
      ? []
      : [{ name: "summary", value: fields.summary }]),
    ...(fields.questions ?? []).map((value, i) => ({
      name: `questions.${i}`,
      value,
    })),
    ...(fields.refs ?? []).map((value, i) => ({ name: `refs.${i}`, value })),
  ]);
}

/** D22: an observation carries its evidence (a test, a CI run, a commit) as a ref. */
function assertEvidence(kind: string, refs: string[]): void {
  if (kind === "observation" && refs.length === 0) {
    throw new HttpError(
      400,
      "evidence_required",
      "An observation needs evidence: at least one ref (a test, a CI run, a commit).",
      { field: "refs" },
    );
  }
}

/** Where a capture lands: the named memory, else the default Inbox of the named or own brain. */
async function captureTarget(
  db: DbOrTx,
  actor: Actor,
  body: CaptureRequest,
): Promise<{ memory: MemoryRow; role: Role }> {
  if (body.memory_id) {
    const found = await findMemory(db, actor, body.memory_id);
    if (body.workspace_id && body.workspace_id !== found.memory.workspaceId) {
      throw new HttpError(
        400,
        "invalid_request",
        "The memory is not in that workspace.",
        {
          field: "workspace_id",
        },
      );
    }
    return found;
  }
  const workspaceId = body.workspace_id ?? (await ownWorkspace(db, actor));
  const roles = await workspaceRoles(db, actor, workspaceId);
  return {
    memory: await defaultMemory(db, workspaceId, "short"),
    role: roles.get(workspaceId)!,
  };
}

/** Join condition: the caller's membership row in the entry's workspace (hard rule 4). */
export const memberOfEntryWorkspace = (actor: Actor) =>
  and(
    eq(members.workspaceId, entries.workspaceId),
    eq(members.userId, personOf(actor)),
  );

/**
 * Checks a capture and stores it, in the caller's transaction: the target and the caller's
 * rights (404, 403), the summary and evidence rules (400), secrets (422), then quarantine.
 */
export async function captureInTx(
  tx: DbOrTx,
  actor: Actor,
  body: CaptureRequest,
  now: Date,
): Promise<EntryRow> {
  const { memory, role } = await captureTarget(tx, actor, body);
  assertMayWrite(actor, memory, role);
  if (actor.kind === "agent" && memory.layer !== "short") {
    throw new HttpError(
      403,
      "agent_inbox_only",
      "Agents capture into an Inbox; a person keeps it in a Notebook.",
    );
  }
  if (actor.kind === "agent" && body.summary === undefined) {
    throw new HttpError(
      400,
      "summary_required",
      "An agent's write must carry a summary of what it wrote.",
      { field: "summary" },
    );
  }
  if (body.source !== undefined && body.kind !== "external") {
    throw new HttpError(
      400,
      "external_kind",
      "Text from the web or an import is kind external.",
      { field: "kind" },
    );
  }
  const refs = body.refs ?? [];
  const questions = body.questions ?? [];
  assertEvidence(body.kind, refs);
  refuseSecretsIn({ ...body, refs, questions });

  const source = body.source ?? actor.kind;
  const summary = body.summary ?? fallbackSummary(body.title, body.body);
  const reason = quarantineReason(source, { ...body, summary, questions });
  const trust: TrustLevel =
    reason !== undefined
      ? "quarantined"
      : actor.kind === "agent"
        ? "proposed"
        : "approved";
  const author = actor.kind === "human" ? actor.user_id : actor.agent_id;
  const expiresAt =
    memory.layer === "short"
      ? new Date(now.getTime() + INBOX_TTL_DAYS * 24 * 3600 * 1000)
      : null;

  const [row] = await tx
    .insert(entries)
    .values({
      workspaceId: memory.workspaceId,
      memoryId: memory.id,
      layer: memory.layer,
      kind: body.kind,
      topic: body.topic ?? null,
      trust,
      title: body.title,
      body: body.body,
      summary,
      summarySource: body.summary === undefined ? "fallback" : "writer",
      questions,
      refs,
      authorKind: actor.kind,
      author,
      onBehalfOf: personOf(actor),
      source,
      quarantinedBecause: reason ?? null,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await tx.insert(entryVersions).values({
    ...versionOf(row!, now),
    // Encoding context (D30): the hat of the binding that wrote it, provenance only.
    captureHatId: actor.kind === "agent" ? (actor.hat?.id ?? null) : null,
  });
  const who = auditActor(actor);
  await writeAudit(tx, {
    workspaceId: memory.workspaceId,
    actor: who.actor,
    action: "entry.capture",
    targetId: row!.id,
    details: { ...who.details, memory_id: memory.id, trust, kind: body.kind },
  });
  return row!;
}

/** One capture in its own transaction. */
export function captureEntry(
  db: Db,
  actor: Actor,
  body: CaptureRequest,
  now: Date,
): Promise<EntryRow> {
  return db.transaction((tx) => captureInTx(tx, actor, body, now));
}

function versionOf(
  row: EntryRow,
  now: Date,
): typeof entryVersions.$inferInsert {
  return {
    entryId: row.id,
    version: row.version,
    kind: row.kind,
    topic: row.topic,
    title: row.title,
    body: row.body,
    summary: row.summary,
    summarySource: row.summarySource,
    questions: row.questions,
    refs: row.refs,
    authorKind: row.authorKind,
    author: row.author,
    quarantinedBecause: row.quarantinedBecause,
    createdAt: now,
  };
}

/** One entry the caller may read, with its memory and their role. Agents never see held text. */
export async function findEntry(
  db: DbOrTx,
  actor: Actor,
  entryId: string,
): Promise<{ entry: EntryRow; memory: MemoryRow; role: Role }> {
  const [row] = await db.select().from(entries).where(eq(entries.id, entryId));
  if (!row) throw new HttpError(404, "not_found", "No such entry.");
  let found: { memory: MemoryRow; role: Role };
  try {
    found = await findMemory(db, actor, row.memoryId);
  } catch {
    throw new HttpError(404, "not_found", "No such entry.");
  }
  if (
    (actor.kind === "agent" && !AGENT_READABLE.includes(row.trust)) ||
    !(await coreEntryInHat(db, actor, row))
  ) {
    throw new HttpError(404, "not_found", "No such entry.");
  }
  return { entry: row, ...found };
}

export async function entryVersionsOf(
  db: DbOrTx,
  entryId: string,
): Promise<VersionRow[]> {
  return db
    .select()
    .from(entryVersions)
    .where(eq(entryVersions.entryId, entryId))
    .orderBy(asc(entryVersions.version));
}

/** A person's new version: new text, kind or summary. Their text is approved unless held. */
export async function reviseEntry(
  db: Db,
  actor: Actor & { kind: "human" },
  entryId: string,
  body: ReviseRequest,
  now: Date,
): Promise<EntryRow> {
  const { entry, memory, role } = await findEntry(db, actor, entryId);
  assertMayWrite(actor, memory, role);
  const title = body.title ?? entry.title;
  const text = body.body ?? entry.body;
  const textChanged = title !== entry.title || text !== entry.body;
  const summaryGiven = body.summary !== undefined;
  const summary = summaryGiven
    ? body.summary!
    : textChanged
      ? fallbackSummary(title, text)
      : entry.summary;
  const summarySource = summaryGiven
    ? "writer"
    : textChanged
      ? "fallback"
      : entry.summarySource;
  const questions = body.questions ?? entry.questions;
  const refs = body.refs ?? entry.refs;
  const kind = body.kind ?? entry.kind;
  if (
    entry.source !== "human" &&
    entry.source !== "agent" &&
    kind !== "external"
  ) {
    throw new HttpError(
      400,
      "external_kind",
      "Text from the web or an import is kind external.",
      {
        field: "kind",
      },
    );
  }
  assertEvidence(kind, refs);
  refuseSecretsIn({ title, body: text, summary, questions, refs });
  const reason = quarantineReason("human", {
    title,
    body: text,
    summary,
    questions,
  });

  return db.transaction(async (tx) => {
    const next: EntryRow = {
      ...entry,
      version: entry.version + 1,
      kind,
      topic: body.topic === undefined ? entry.topic : body.topic,
      title,
      body: text,
      summary,
      summarySource,
      questions,
      refs,
      trust: reason !== undefined ? "quarantined" : "approved",
      quarantinedBecause: reason ?? null,
    };
    await tx.insert(entryVersions).values({
      ...versionOf(next, now),
      authorKind: "human",
      author: actor.user_id,
    });
    const [row] = await tx
      .update(entries)
      .set({
        version: next.version,
        kind: next.kind,
        topic: next.topic,
        title: next.title,
        body: next.body,
        summary: next.summary,
        summarySource: next.summarySource,
        questions: next.questions,
        refs: next.refs,
        trust: next.trust,
        quarantinedBecause: next.quarantinedBecause,
      })
      .where(and(eq(entries.id, entry.id), eq(entries.version, entry.version)))
      .returning();
    if (!row) {
      throw new HttpError(
        409,
        "stale_version",
        "Someone else changed this entry; read it again.",
      );
    }
    await writeAudit(tx, {
      workspaceId: entry.workspaceId,
      actor: `human:${actor.user_id}`,
      action: "entry.revise",
      targetId: entry.id,
      details: { version: next.version, trust: next.trust, kind },
    });
    return row;
  });
}

/** A person approves or rejects. Approving also releases a quarantined entry. */
export async function setTrust(
  db: Db,
  actor: Actor & { kind: "human" },
  entryId: string,
  to: "approved" | "rejected",
): Promise<EntryRow> {
  return db.transaction((tx) => setTrustInTx(tx, actor, entryId, to));
}

/** `setTrust` inside the caller's transaction (an approval request applies several at once). */
export async function setTrustInTx(
  tx: DbOrTx,
  actor: Actor & { kind: "human" },
  entryId: string,
  to: "approved" | "rejected",
): Promise<EntryRow> {
  const { entry, memory, role } = await findEntry(tx, actor, entryId);
  assertMayWrite(actor, memory, role);
  if (entry.trust === to) {
    throw new HttpError(409, "invalid_state", `The entry is already ${to}.`);
  }
  const [row] = await tx
    .update(entries)
    .set({ trust: to, quarantinedBecause: null })
    .where(and(eq(entries.id, entry.id), eq(entries.trust, entry.trust)))
    .returning();
  if (!row) {
    throw new HttpError(
      409,
      "stale_version",
      "Someone else changed this entry; read it again.",
    );
  }
  await writeAudit(tx, {
    workspaceId: entry.workspaceId,
    actor: `human:${actor.user_id}`,
    action: to === "approved" ? "entry.approve" : "entry.reject",
    targetId: entry.id,
    details: { from: entry.trust, to },
  });
  return row;
}
