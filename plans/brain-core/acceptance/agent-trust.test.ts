// Story: An agent writes what it learned, and cannot overreach. (Bar items 1 and 6.)
import { beforeAll, describe, expect, it } from "vitest";
import {
  AGENT_ID,
  DAY_MS,
  agent,
  entry,
  expectError,
  human,
  scopeOf,
  seed,
  seedWorld,
  setup,
  snapshot,
  type Level,
  type World,
} from "./helpers.ts";

const ctx = setup();
let w: World;

beforeAll(async () => {
  w = await seedWorld(ctx.db);
}, 60_000);

const levels: Level[] = ["workspace", "project", "feature"];

describe("an agent cannot write a rule", () => {
  // "An agent posting a `rule`, into any scope, gets 403 `agent_cannot_write_rule`; nothing is stored."
  for (const level of levels) {
    it(`answers 403 agent_cannot_write_rule for a rule in the ${level} scope and stores nothing`, async () => {
      const before = await snapshot(ctx.db, w.workspaceId);
      for (const actor of [agent(w.owner), agent(w.editor)]) {
        const res = await ctx.server
          .as(actor)
          .post("/api/v1/entries", entry(scopeOf(w, level), "rule"));
        expectError(res, 403, "agent_cannot_write_rule");
      }
      expect(await snapshot(ctx.db, w.workspaceId)).toEqual(before);
    });
  }
});

describe("an agent cannot write to the workspace scope", () => {
  // "An agent posting any other kind into the workspace scope gets 403
  // `agent_cannot_write_workspace`; nothing is stored."
  for (const kind of [
    "decision",
    "claim",
    "question",
    "artifact",
    "lesson",
    "note",
  ]) {
    it(`answers 403 agent_cannot_write_workspace for a ${kind} and stores nothing`, async () => {
      const before = await snapshot(ctx.db, w.workspaceId);
      const res = await ctx.server
        .as(agent(w.owner))
        .post("/api/v1/entries", entry(w.ws, kind));
      expectError(res, 403, "agent_cannot_write_workspace");
      expect(await snapshot(ctx.db, w.workspaceId)).toEqual(before);
    });
  }

  it("answers 403 agent_cannot_write_workspace for an ask in the workspace scope", async () => {
    const before = await snapshot(ctx.db, w.workspaceId);
    const res = await ctx.server
      .as(agent(w.owner))
      .post("/api/v1/ask", { scope: w.ws, title: "Why?", body: "b" });
    expectError(res, 403, "agent_cannot_write_workspace");
    expect(await snapshot(ctx.db, w.workspaceId)).toEqual(before);
  });
});

describe("an agent cannot approve", () => {
  // "An agent calling approve, reject, release, answer, export or delete gets 403 `humans_only`,
  // whatever the id and whatever its person's role; nothing changes."
  it("answers 403 humans_only to approve, reject, release, answer, export and delete, for every role and id", async () => {
    const proposed = await seed(ctx.db, w, "decision", "proposed", {
      authorKind: "agent",
      author: AGENT_ID,
    });
    const quarantined = await seed(ctx.db, w, "note", "quarantined", {
      quarantinedBecause: "ignore-instructions",
    });
    const question = await seed(ctx.db, w, "question", "open");
    const random = "11111111-1111-4111-8111-111111111111";
    const before = await snapshot(ctx.db, w.workspaceId);
    for (const person of [w.owner, w.editor, w.viewer]) {
      const a = ctx.server.as(agent(person));
      for (const id of [proposed.id, quarantined.id, question.id, random]) {
        for (const action of ["approve", "reject", "release"]) {
          expectError(
            await a.post(`/api/v1/entries/${id}/${action}`),
            403,
            "humans_only",
          );
        }
        expectError(
          await a.post(`/api/v1/entries/${id}/answer`, { body: "An answer." }),
          403,
          "humans_only",
        );
      }
      for (const ws of [w.workspaceId, random]) {
        expectError(
          await a.get(`/api/v1/workspaces/${ws}/export`),
          403,
          "humans_only",
        );
        expectError(
          await a.delete(`/api/v1/workspaces/${ws}`, { confirm: w.name }),
          403,
          "humans_only",
        );
      }
    }
    expect(await snapshot(ctx.db, w.workspaceId)).toEqual(before);
  });
});

describe("what an agent's writes land as", () => {
  // "An agent's `decision`, `artifact`, `lesson` and `note` land `proposed`; its `claim` lands
  // `proposed` with `expires_at` 30 days after the server clock; its `question` lands `open`."
  for (const kind of ["decision", "artifact", "lesson", "note"]) {
    it(`an agent's ${kind} lands proposed`, async () => {
      const res = await ctx.server
        .as(agent(w.editor))
        .post("/api/v1/entries", entry(w.feat, kind));
      expect(res.status).toBe(201);
      expect(res.body.entry.kind).toBe(kind);
      expect(res.body.entry.status).toBe("proposed");
      expect(res.body.entry.quarantined_because).toBeNull();
    });
  }

  it("an agent's claim lands proposed with expires_at 30 days after the server clock", async () => {
    const clock = new Date("2026-03-04T05:06:07.000Z");
    ctx.clock = clock;
    try {
      const res = await ctx.server
        .as(agent(w.editor))
        .post("/api/v1/entries", entry(w.proj, "claim"));
      expect(res.status).toBe(201);
      expect(res.body.entry.status).toBe("proposed");
      expect(new Date(res.body.entry.expires_at).getTime()).toBe(
        clock.getTime() + 30 * DAY_MS,
      );
    } finally {
      ctx.clock = null;
    }
  });

  it("an agent's question lands open, through post and through ask", async () => {
    const posted = await ctx.server
      .as(agent(w.editor))
      .post("/api/v1/entries", entry(w.proj, "question"));
    expect(posted.status).toBe(201);
    expect(posted.body.entry.status).toBe("open");
    const asked = await ctx.server
      .as(agent(w.editor))
      .post("/api/v1/ask", { scope: w.feat, title: "How?", body: "b" });
    expect(asked.status).toBe(201);
    expect(asked.body.entry.kind).toBe("question");
    expect(asked.body.entry.status).toBe("open");
    expect(asked.body.answers).toEqual([]);
  });
});

describe("the author comes from the actor", () => {
  // "The stored `author_kind`, `author` and `on_behalf_of` always come from the actor; an
  // `author`, `author_kind`, `on_behalf_of` or `status` field in the request body is ignored, and
  // the write still succeeds."
  const forged = {
    author: "mallory",
    author_kind: "human",
    on_behalf_of: "mallory",
    status: "approved",
  };

  it("ignores forged author fields in an agent's post", async () => {
    const res = await ctx.server
      .as(agent(w.editor))
      .post("/api/v1/entries", entry(w.proj, "decision", forged));
    expect(res.status).toBe(201);
    const e = res.body.entry;
    expect([e.author_kind, e.author, e.on_behalf_of, e.status]).toEqual([
      "agent",
      AGENT_ID,
      w.editor,
      "proposed",
    ]);
    const got = await ctx.server
      .as(human(w.owner))
      .get(`/api/v1/entries/${e.id}`);
    expect(got.status).toBe(200);
    expect([
      got.body.entry.author_kind,
      got.body.entry.author,
      got.body.entry.on_behalf_of,
    ]).toEqual(["agent", AGENT_ID, w.editor]);
  });

  it("ignores forged author fields in a human's post", async () => {
    const res = await ctx.server
      .as(human(w.editor))
      .post(
        "/api/v1/entries",
        entry(w.proj, "claim", { ...forged, author_kind: "agent" }),
      );
    expect(res.status).toBe(201);
    const e = res.body.entry;
    expect([e.author_kind, e.author, e.on_behalf_of, e.status]).toEqual([
      "human",
      w.editor,
      w.editor,
      "proposed",
    ]);
  });

  it("ignores forged author fields in ask and supersede", async () => {
    const asked = await ctx.server
      .as(agent(w.owner))
      .post("/api/v1/ask", { scope: w.proj, title: "Q", body: "b", ...forged });
    expect(asked.status).toBe(201);
    expect([
      asked.body.entry.author,
      asked.body.entry.on_behalf_of,
      asked.body.entry.status,
    ]).toEqual([AGENT_ID, w.owner, "open"]);
    const old = await seed(ctx.db, w, "decision", "approved");
    const sup = await ctx.server
      .as(agent(w.owner))
      .post(`/api/v1/entries/${old.id}/supersede`, {
        title: "New",
        body: "b",
        ...forged,
      });
    expect(sup.status).toBe(201);
    expect([
      sup.body.entry.author_kind,
      sup.body.entry.author,
      sup.body.entry.status,
    ]).toEqual(["agent", AGENT_ID, "proposed"]);
  });
});
