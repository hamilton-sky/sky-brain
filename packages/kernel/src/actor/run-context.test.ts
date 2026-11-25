// The run context kept beside the actor (cloud-task-board ticket 02).
import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { runContextOf, setRunContext, type RunContext } from "./run-context.ts";

const req = () => ({}) as Request;

describe("run context", () => {
  it("is undefined for a request that has none", () => {
    expect(runContextOf(req())).toBeUndefined();
  });

  it("returns what was set, for that request only", () => {
    const a = req();
    const b = req();
    const run: RunContext = {
      kind: "run",
      deviceId: "d1",
      tokenId: "t1",
      workspaceId: "w1",
      projectId: "p1",
      role: "viewer",
      verbs: ["read"],
    };
    const dev: RunContext = {
      kind: "device",
      deviceId: "d2",
      tokenId: "d2",
      verbs: [],
    };
    setRunContext(a, run);
    setRunContext(b, dev);
    expect(runContextOf(a)).toEqual(run);
    expect(runContextOf(b)).toEqual(dev);
    expect(runContextOf(req())).toBeUndefined();
  });
});
