// Story: Find a project by its git remote.
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeGitRemote } from "../../../packages/shared/src/git-remote.ts";
import { seedFeature } from "../../../apps/server/src/testing/harness.ts";
import {
  agent,
  expectError,
  human,
  seedWorld,
  setup,
  uid,
  type World,
} from "./helpers.ts";

const ctx = setup();
let w: World;
let other: World;
let archived: { id: string };

const forms = [
  "https://github.com/Hamilton-Sky/sky-brain.git",
  "git@github.com:hamilton-sky/sky-brain.git",
  "ssh://git@github.com:22/hamilton-sky/sky-brain",
  "https://x-access-token:abc123@github.com/hamilton-sky/sky-brain/",
  "git://github.com/hamilton-sky/sky-brain",
  "  https://github.com//hamilton-sky//sky-brain.git  ",
  "git+ssh://git@github.com/hamilton-sky/sky-brain.git",
  "http://github.com/hamilton-sky/sky-brain",
];

beforeAll(async () => {
  w = await seedWorld(ctx.db, {
    gitRemote: "https://github.com/Hamilton-Sky/sky-brain.git",
  });
  other = await seedWorld(ctx.db, {
    gitRemote: "git@github.com:hamilton-sky/sky-brain.git",
  });
  archived = await seedFeature(ctx.db, {
    projectId: w.projectId,
    slug: uid("old"),
    name: "Old feature",
  });
}, 60_000);

describe("normalizeGitRemote", () => {
  // Interfaces -> Git remote normalization table.
  const table: [string, string | null][] = [
    [
      "https://github.com/Hamilton-Sky/sky-brain.git",
      "github.com/hamilton-sky/sky-brain",
    ],
    [
      "git@github.com:hamilton-sky/sky-brain.git",
      "github.com/hamilton-sky/sky-brain",
    ],
    [
      "ssh://git@github.com:22/hamilton-sky/sky-brain",
      "github.com/hamilton-sky/sky-brain",
    ],
    [
      "https://x-access-token:abc123@github.com/hamilton-sky/sky-brain/",
      "github.com/hamilton-sky/sky-brain",
    ],
    [
      "git://github.com/hamilton-sky/sky-brain",
      "github.com/hamilton-sky/sky-brain",
    ],
    [
      "http://gitlab.example.com:8443/group/sub/repo.git",
      "gitlab.example.com/group/sub/repo",
    ],
    ["not a remote", null],
    ["", null],
    ["https://github.com", null],
  ];
  for (const [input, want] of table) {
    it(`normalizes ${JSON.stringify(input)} to ${JSON.stringify(want)}`, () => {
      expect(normalizeGitRemote(input)).toBe(want);
    });
  }
});

describe("POST /api/v1/projects/lookup", () => {
  // "`POST /api/v1/projects/lookup` with any form of the same remote (https, ssh, scp-like, with
  // credentials, with `.git`) returns the same project and its features."
  for (const remote of forms) {
    it(`finds the project for ${JSON.stringify(remote)}`, async () => {
      const res = await ctx.server
        .as(agent(w.editor))
        .post("/api/v1/projects/lookup", {
          workspace_id: w.workspaceId,
          git_remote: remote,
        });
      expect(res.status).toBe(200);
      expect(res.body.project).toMatchObject({
        id: w.projectId,
        workspace_id: w.workspaceId,
        git_remote: "github.com/hamilton-sky/sky-brain",
      });
      expect(typeof res.body.project.slug).toBe("string");
      expect(typeof res.body.project.name).toBe("string");
      const feats = res.body.features as {
        id: string;
        slug: string;
        name: string;
        archived_at: unknown;
      }[];
      expect(feats.map((f) => f.id).sort()).toEqual(
        [w.featureId, archived.id].sort(),
      );
      for (const f of feats) {
        expect(Object.keys(f).sort()).toEqual([
          "archived_at",
          "id",
          "name",
          "slug",
        ]);
      }
    });
  }

  it("works for a human member, including a viewer", async () => {
    for (const person of [w.owner, w.viewer]) {
      const res = await ctx.server
        .as(human(person))
        .post("/api/v1/projects/lookup", {
          workspace_id: w.workspaceId,
          git_remote: forms[1],
        });
      expect(res.status).toBe(200);
      expect(res.body.project.id).toBe(w.projectId);
    }
  });

  it("finds the project of the workspace asked for when two workspaces share a remote", async () => {
    const res = await ctx.server
      .as(human(other.owner))
      .post("/api/v1/projects/lookup", {
        workspace_id: other.workspaceId,
        git_remote: forms[0],
      });
    expect(res.status).toBe(200);
    expect(res.body.project.id).toBe(other.projectId);
  });

  // Edge: "Git remote that cannot be normalized | 400 `invalid_remote`"
  it("answers 400 invalid_remote to a remote that cannot be normalized", async () => {
    for (const remote of ["not a remote", "https://github.com"]) {
      expectError(
        await ctx.server
          .as(agent(w.editor))
          .post("/api/v1/projects/lookup", {
            workspace_id: w.workspaceId,
            git_remote: remote,
          }),
        400,
        "invalid_remote",
      );
    }
  });

  it("answers 404 not_found to a remote no project of the workspace has", async () => {
    expectError(
      await ctx.server.as(agent(w.editor)).post("/api/v1/projects/lookup", {
        workspace_id: w.workspaceId,
        git_remote: "https://github.com/nobody/nothing.git",
      }),
      404,
      "not_found",
    );
  });
});
