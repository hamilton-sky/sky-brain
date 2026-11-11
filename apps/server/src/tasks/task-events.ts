// The only writer of `task_events` (cloud-task-board spec.md Events and audit): one insert, no
// update or delete (a trigger refuses those too). Who did it comes from the request's actor and
// run context, never from a body; tickets 05 (created), 06 and 07 use it.
import type { TaskEventKind } from "@sky-brain/shared/tasks";
import type { Request } from "express";
import { auditActor, personOf } from "../actor/keys.ts";
import { actorOf } from "../actor/middleware.ts";
import { runContextOf } from "../actor/run-context.ts";
import type { DbOrTx } from "../db/client.ts";
import { taskEvents } from "../db/schema.ts";

export interface TaskEvent {
  task: { id: string; workspaceId: string; claimSeq: number };
  kind: TaskEventKind;
  req: Request;
  /** The app clock. */
  at: Date;
  /** Default: the task's own `claim_seq`. */
  claimSeq?: number;
  /** Ids and states only, never text. */
  details?: Record<string, unknown>;
}

export async function writeTaskEvent(
  tx: DbOrTx,
  event: TaskEvent,
): Promise<void> {
  const actor = actorOf(event.req);
  await tx.insert(taskEvents).values({
    workspaceId: event.task.workspaceId,
    taskId: event.task.id,
    kind: event.kind,
    actor: auditActor(actor).actor,
    onBehalfOf: personOf(actor),
    deviceId: runContextOf(event.req)?.deviceId ?? null,
    claimSeq: event.claimSeq ?? event.task.claimSeq,
    at: event.at,
    details: event.details ?? {},
  });
}
