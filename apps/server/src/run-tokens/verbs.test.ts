// The verb check and project binding of run tokens (cloud-task-board ticket 02).
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { members } from "../db/schema.ts";
import type { TestResponse } from "../testing/harness.ts";
import { mintRunToken, withToken } from "../testing/task-seeds.ts";
import {
  UUID,
  device,
  expectError,
  useRunTokenFixture,
  world,
} from "./tests/fixture.ts";
import { verbFor } from "./verbs.ts";

const ctx = useRunTokenFixture();

describe("the verb table", () => {
  it("names the verb of every route in spec.md Routes, and nothing for the rest", () => {
    const cases: [string, string, string | undefined][] = [
      ["POST", "/run-tokens", "mint"],
      ["POST", "/goals", "plan"],
      ["GET", "/goals", "read"],
      ["GET", `/goals/${UUID}`, "read"],
      ["POST", `/goals/${UUID}/tasks`, "plan"],
      ["GET", "/tasks/ready", "read"],
      ["GET", `/tasks/${UUID}`, "read"],
      ["POST", `/tasks/${UUID}/claim`, "claim"],
      ["POST", `/tasks/${UUID}/renew`, "claim"],
      ["POST", `/tasks/${UUID}/release`, "claim"],
      ["POST", `/tasks/${UUID}/done`, "report"],
      ["POST", `/tasks/${UUID}/fail`, "report"],
      ["POST", "/goals/", "plan"],
      // Human-only routes, brain-core's entries and the devices routes are not in the table.
      ["POST", `/goals/${UUID}/approve`, undefined],
      ["POST", `/goals/${UUID}/cancel`, undefined],
      ["POST", `/goals/${UUID}/release`, undefined],
      ["POST", `/tasks/${UUID}/release-text`, undefined],
      ["POST", "/entries", undefined],
      ["GET", "/entries", undefined],
      ["GET", "/devices", undefined],
      ["POST", "/devices/approve", undefined],
      ["GET", "/run-tokens", undefined],
      ["DELETE", `/tasks/${UUID}`, undefined],
      ["HEAD", "/goals", undefined],
      ["GET", `/tasks/${UUID}/claim/x`, undefined],
      ["GET", "/tasks//", undefined],
      ["GET", "/", undefined],
    ];
    expect(
      cases.map(([method, path]) => [method, path, verbFor(method, path)]),
    ).toEqual(cases);
  });
});

describe("verbs over HTTP", () => {
  it("a token without claim calling a claim route gets 403 verb_not_allowed; with claim it passes", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const noClaim = await mintRunToken(ctx.server, d.deviceToken, {
      project_id: w.projectA,
      verbs: ["read", "report"],
    });
    const claim = await mintRunToken(ctx.server, d.deviceToken, {
      project_id: w.projectA,
      verbs: ["claim"],
    });
    const path = `/api/v1/tasks/${UUID}/claim`;
    expectError(
      await ctx.onProbe(noClaim.runToken).post(path, {}),
      403,
      "verb_not_allowed",
    );
    expectError(
      await withToken(ctx.server, noClaim.runToken).post(path, {}),
      403,
      "verb_not_allowed",
    );
    expect((await ctx.onProbe(claim.runToken).post(path, {})).status).toBe(200);
    expectError(
      await ctx.onProbe(claim.runToken).get(`/api/v1/goals/${w.projectA}`),
      403,
      "verb_not_allowed",
    );
  });

  it("a device token calling anything but mint gets 403 verb_not_allowed", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const c = withToken(ctx.server, d.deviceToken);
    const calls: Promise<TestResponse>[] = [
      c.get("/api/v1/devices"),
      c.post(`/api/v1/devices/${d.deviceId}/revoke`, {}),
      c.get(`/api/v1/tasks/ready?project_id=${w.projectA}`),
      c.get(`/api/v1/goals/${UUID}`),
      c.post("/api/v1/goals", { project_id: w.projectA }),
      c.post(`/api/v1/tasks/${UUID}/claim`, {}),
      c.post("/api/v1/entries", {}),
      ctx.onProbe(d.deviceToken).get(`/api/v1/goals/${w.projectA}`),
    ];
    for (const res of await Promise.all(calls)) {
      expectError(res, 403, "verb_not_allowed");
    }
  });

  it("POST /api/v1/entries with any run token gets 403 verb_not_allowed", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.owner);
    const all = await mintRunToken(ctx.server, d.deviceToken, {
      project_id: w.projectA,
      verbs: ["read", "plan", "claim", "report"],
    });
    const c = withToken(ctx.server, all.runToken);
    expectError(
      await c.post("/api/v1/entries", {
        scope: { project_id: w.projectA },
        kind: "note",
        title: "n",
        body: "b",
      }),
      403,
      "verb_not_allowed",
    );
    expectError(await c.get("/api/v1/entries"), 403, "verb_not_allowed");
    expectError(
      await c.post(`/api/v1/goals/${UUID}/approve`, {}),
      403,
      "verb_not_allowed",
    );
  });

  it("people are not checked against the verb table", async () => {
    const res = await ctx.server
      .as({ kind: "human", user_id: "rt-person" })
      .get("/api/v1/devices");
    expect(res.status).toBe(200);
  });
});

describe("project binding and role", () => {
  it("a token for project A gets 404 from assertRunScope for project B in the same workspace", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const run = await mintRunToken(ctx.server, d.deviceToken, {
      project_id: w.projectA,
      verbs: ["read"],
    });
    const c = ctx.onProbe(run.runToken);
    expect((await c.get(`/api/v1/goals/${w.projectA}`)).status).toBe(200);
    expectError(await c.get(`/api/v1/goals/${w.projectB}`), 404, "not_found");
    expectError(await c.get(`/api/v1/goals/${w.projectC}`), 404, "not_found");
  });

  it("effectiveRole is the lower of the token's role and the member's role", async () => {
    const w = await world(ctx.db);
    const d = await device(ctx.server, w.editor);
    const viewerToken = await mintRunToken(ctx.server, d.deviceToken, {
      project_id: w.projectA,
      verbs: ["read"],
      role: "viewer",
    });
    const editorToken = await mintRunToken(ctx.server, d.deviceToken, {
      project_id: w.projectA,
      verbs: ["read"],
    });
    const roleOf = async (token: string) =>
      (await ctx.onProbe(token).get(`/api/v1/goals/${w.projectA}`)).body.role;
    expect(await roleOf(viewerToken.runToken)).toBe("viewer");
    expect(await roleOf(editorToken.runToken)).toBe("editor");
    await ctx.db
      .update(members)
      .set({ role: "viewer" })
      .where(
        and(
          eq(members.workspaceId, w.workspaceId),
          eq(members.userId, w.editor),
        ),
      );
    expect(await roleOf(editorToken.runToken)).toBe("viewer");
  });
});
