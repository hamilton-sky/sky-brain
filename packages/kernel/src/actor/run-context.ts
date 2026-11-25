// The device or run token a request came with, kept beside its actor (cloud-task-board spec.md
// Design). The `Actor` union does not change; routes read this with `runContextOf(req)`.
import type { Role } from "@sky-brain/shared/enums";
import type { Verb } from "@sky-brain/shared/run-tokens";
import type { Request } from "express";

export interface RunContext {
  /** `device`: a device token (`sbd_`), which may only mint. `run`: a run token (`sbr_`). */
  kind: "device" | "run";
  deviceId: string;
  /** The run token's id; for a device token, the device's id. */
  tokenId: string;
  /** Set for a run token: what it is bound to. */
  workspaceId?: string;
  projectId?: string;
  role?: Role;
  verbs: readonly Verb[];
}

const contexts = new WeakMap<Request, RunContext>();

export function setRunContext(req: Request, context: RunContext): void {
  contexts.set(req, context);
}

/** Undefined for a request that came without a device or run token. */
export function runContextOf(req: Request): RunContext | undefined {
  return contexts.get(req);
}
