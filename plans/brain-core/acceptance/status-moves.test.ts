// Edge cases about supersede, approve, reject, release, answers, sources and search.
import { beforeAll, describe, expect, it } from "vitest";
import {
  AGENT_ID,
  DAY_MS,
  agent,
  entry,
  expectError,
  human,
  seed,
  seedWorld,
  setup,
  snapshot,
  type World,
} from "./helpers.ts";

const ctx = setup();
let w: World;

beforeAll(async () => {
  w = await seedWorld(ctx.db);
}, 60_000);

const owner = () => ctx.server.as(human(w.owner));
const statusOf = async (id: string) =>
  (await owner().get(`/api/v1/entries/${id}`)).body.entry.status;
const past = () => new Date(Date.now() - DAY_MS);

describe("supersede", () => {
  // Edge: "Supersede of a superseded, rejected, expired or quarantined entry | 409 `not_in_force`
  // (an agent gets 404 for a quarantined one: it cannot see it)"
  it("answers 409 not_in_force for a superseded, rejected, expired or quarantined entry", async () => {
    const targets = [
      await seed(ctx.db, w, "decision", "superseded"),
      await seed(ctx.db, w, "decision", "rejected"),
      await seed(ctx.db, w, "claim", "proposed", { expiresAt: past() }),
      await seed(ctx.db, w, "decision", "quarantined", {
        quarantinedBecause: "role-tag",
      }),
    ];
    const before = await snapshot(ctx.db, w.workspaceId);
    for (const t of targets) {
      expectError(
        await owner().post(`/api/v1/entries/${t.id}/supersede`, {
          title: "New",
          body: "b",
        }),
        409,
        "not_in_force",
      );
    }
    for (const t of targets.slice(0, 3)) {
      expectError(
        await ctx.server
          .as(agent(w.editor))
          .post(`/api/v1/entries/${t.id}/supersede`, {
            title: "New",
            body: "b",
          }),
        409,
        "not_in_force",
      );
    }
    expectError(
      await ctx.server
        .as(agent(w.editor))
        .post(`/api/v1/entries/${targets[3].id}/supersede`, {
          title: "New",
          body: "b",
        }),
      404,
      "not_found",
    );
    expect(await snapshot(ctx.db, w.workspaceId)).toEqual(before);
  });

  // Edge: "Supersede changing the kind (other than claim -> decision) | 400 `kind_change_not_allowed`"
  it("answers 400 kind_change_not_allowed to a kind change other than claim to decision", async () => {
    const decision = await seed(ctx.db, w, "decision", "approved");
    expectError(
      await owner().post(`/api/v1/entries/${decision.id}/supersede`, {
        title: "N",
        body: "b",
        kind: "rule",
      }),
      400,
      "kind_change_not_allowed",
    );
    const lesson = await seed(ctx.db, w, "lesson", "approved");
    expectError(
      await owner().post(`/api/v1/entries/${lesson.id}/supersede`, {
        title: "N",
        body: "b",
        kind: "note",
      }),
      400,
      "kind_change_not_allowed",
    );
    const claim = await seed(ctx.db, w, "claim", "proposed", {
      expiresAt: new Date(Date.now() + DAY_MS),
    });
    const ok = await owner().post(`/api/v1/entries/${claim.id}/supersede`, {
      title: "N",
      body: "b",
      kind: "decision",
    });
    expect(ok.status).toBe(201);
    expect(ok.body.entry.kind).toBe("decision");
    expect(ok.body.entry.status).toBe("approved");
    expect(ok.body.entry.supersedes).toBe(claim.id);
    expect(await statusOf(claim.id)).toBe("superseded");
    const same = await seed(ctx.db, w, "decision", "approved");
    const keep = await owner().post(`/api/v1/entries/${same.id}/supersede`, {
      title: "N",
      body: "b",
    });
    expect(keep.body.entry.kind).toBe("decision");
  });

  // Edge: "Agent supersedes a rule, or a workspace-scope entry | 403 `agent_cannot_write_rule` /
  // `agent_cannot_write_workspace`"
  it("answers an agent superseding a rule or a workspace-scope entry 403", async () => {
    const rule = await seed(ctx.db, w, "rule", "approved");
    const wsDecision = await seed(ctx.db, w, "decision", "approved", {
      level: "workspace",
    });
    const before = await snapshot(ctx.db, w.workspaceId);
    const a = ctx.server.as(agent(w.owner));
    expectError(
      await a.post(`/api/v1/entries/${rule.id}/supersede`, {
        title: "N",
        body: "b",
      }),
      403,
      "agent_cannot_write_rule",
    );
    expectError(
      await a.post(`/api/v1/entries/${wsDecision.id}/supersede`, {
        title: "N",
        body: "b",
      }),
      403,
      "agent_cannot_write_workspace",
    );
    expect(await snapshot(ctx.db, w.workspaceId)).toEqual(before);
  });
});

describe("approve", () => {
  // Edge: "Approve a replacement whose target is already superseded by another approved entry |
  // 409 `already_superseded`, nothing changes"
  it("answers 409 already_superseded when the target was already superseded", async () => {
    const x = await seed(ctx.db, w, "decision", "approved");
    const a = ctx.server.as(agent(w.editor));
    const y1 = await a.post(`/api/v1/entries/${x.id}/supersede`, {
      title: "Y1",
      body: "b",
    });
    const y2 = await a.post(`/api/v1/entries/${x.id}/supersede`, {
      title: "Y2",
      body: "b",
    });
    expect([y1.status, y2.status]).toEqual([201, 201]);
    expect(
      (await owner().post(`/api/v1/entries/${y1.body.entry.id}/approve`))
        .status,
    ).toBe(200);
    expect(await statusOf(x.id)).toBe("superseded");
    const before = await snapshot(ctx.db, w.workspaceId);
    expectError(
      await owner().post(`/api/v1/entries/${y2.body.entry.id}/approve`),
      409,
      "already_superseded",
    );
    expect(await snapshot(ctx.db, w.workspaceId)).toEqual(before);
    expect(await statusOf(y2.body.entry.id)).toBe("proposed");
  });

  // Edge: "Approve an expired claim | 409 `expired`"
  it("answers 409 expired to approving an expired claim", async () => {
    const claim = await seed(ctx.db, w, "claim", "proposed", {
      expiresAt: past(),
    });
    expect(await statusOf(claim.id)).toBe("expired");
    expectError(
      await owner().post(`/api/v1/entries/${claim.id}/approve`),
      409,
      "expired",
    );
  });

  it("an approved claim loses its expires_at", async () => {
    const claim = await seed(ctx.db, w, "claim", "proposed", {
      expiresAt: new Date(Date.now() + DAY_MS),
    });
    const res = await owner().post(`/api/v1/entries/${claim.id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe("approved");
    expect(res.body.entry.expires_at).toBeNull();
  });

  // Edge: "Approve or release an entry in the wrong status | 409 `invalid_state`"
  it("answers 409 invalid_state to approve or release in the wrong status", async () => {
    const approved = await seed(ctx.db, w, "decision", "approved");
    const rejected = await seed(ctx.db, w, "decision", "rejected");
    const open = await seed(ctx.db, w, "question", "open");
    const quarantined = await seed(ctx.db, w, "note", "quarantined", {
      quarantinedBecause: "role-tag",
    });
    const before = await snapshot(ctx.db, w.workspaceId);
    for (const t of [approved, rejected, open, quarantined]) {
      expectError(
        await owner().post(`/api/v1/entries/${t.id}/approve`),
        409,
        "invalid_state",
      );
    }
    for (const t of [approved, rejected, open]) {
      expectError(
        await owner().post(`/api/v1/entries/${t.id}/release`),
        409,
        "invalid_state",
      );
    }
    expectError(
      await owner().post(`/api/v1/entries/${approved.id}/reject`),
      409,
      "invalid_state",
    );
    expect(await snapshot(ctx.db, w.workspaceId)).toEqual(before);
  });
});

describe("answers", () => {
  // Edge: "Agent answers a human's question, or an agent question without `allow_agent_answers` |
  // 403 `agent_cannot_answer`"
  it("answers 403 agent_cannot_answer to an agent answering a human's question", async () => {
    const q = await seed(ctx.db, w, "question", "open", {
      allowAgentAnswers: true,
    });
    const before = await snapshot(ctx.db, w.workspaceId);
    expectError(
      await ctx.server
        .as(agent(w.editor))
        .post("/api/v1/entries", {
          kind: "answer",
          reply_to: q.id,
          title: "A",
          body: "b",
        }),
      403,
      "agent_cannot_answer",
    );
    expect(await snapshot(ctx.db, w.workspaceId)).toEqual(before);
  });

  it("answers 403 agent_cannot_answer to an agent answering an agent question without allow_agent_answers", async () => {
    const asked = await ctx.server
      .as(agent(w.editor))
      .post("/api/v1/ask", { scope: w.proj, title: "Q", body: "b" });
    expect(asked.status).toBe(201);
    expect(asked.body.entry.allow_agent_answers).toBe(false);
    expectError(
      await ctx.server
        .as(agent(w.owner, "codex/reviewer"))
        .post("/api/v1/entries", {
          kind: "answer",
          reply_to: asked.body.entry.id,
          title: "A",
          body: "b",
        }),
      403,
      "agent_cannot_answer",
    );
  });

  // Trust rules: an agent's answer is `proposed` "and the question becomes `answered`, only when
  // the question's author is an agent and `allow_agent_answers` is true"
  // Edge: "Reject the only answer of an answered question | the question goes back to `open`"
  it("an agent answers an agent question that allows it; rejecting the only answer reopens the question", async () => {
    const asked = await ctx.server
      .as(agent(w.editor))
      .post("/api/v1/ask", {
        scope: w.feat,
        title: "Q",
        body: "b",
        allow_agent_answers: true,
      });
    expect(asked.status).toBe(201);
    expect(asked.body.entry.allow_agent_answers).toBe(true);
    const qid = asked.body.entry.id;
    const ans = await ctx.server
      .as(agent(w.owner, "codex/reviewer"))
      .post("/api/v1/entries", {
        kind: "answer",
        reply_to: qid,
        title: "A",
        body: "Because.",
      });
    expect(ans.status).toBe(201);
    expect(ans.body.entry.status).toBe("proposed");
    expect(ans.body.entry.feature_id).toBe(w.featureId);
    expect(await statusOf(qid)).toBe("answered");

    const got = await owner().get(`/api/v1/entries/${qid}`);
    expect(got.body.answers.map((e: { id: string }) => e.id)).toEqual([
      ans.body.entry.id,
    ]);

    const rej = await owner().post(
      `/api/v1/entries/${ans.body.entry.id}/reject`,
    );
    expect(rej.status).toBe(200);
    expect(await statusOf(qid)).toBe("open");
  });

  it("rejecting one of two answers leaves the question answered", async () => {
    const q = await seed(ctx.db, w, "question", "open", {
      authorKind: "agent",
      author: AGENT_ID,
      onBehalfOf: w.editor,
      allowAgentAnswers: true,
    });
    const answerer = ctx.server.as(agent(w.owner, "codex/reviewer"));
    const a1 = await answerer.post("/api/v1/entries", {
      kind: "answer",
      reply_to: q.id,
      title: "A1",
      body: "One.",
    });
    const a2 = await answerer.post("/api/v1/entries", {
      kind: "answer",
      reply_to: q.id,
      title: "A2",
      body: "Two.",
    });
    expect([a1.status, a2.status]).toEqual([201, 201]);
    expect(
      (await owner().post(`/api/v1/entries/${a1.body.entry.id}/reject`)).status,
    ).toBe(200);
    expect(await statusOf(q.id)).toBe("answered");
  });

  // Edge: "`kind: "answer"` whose `reply_to` is not a question that is `open` or `answered` | 409 `invalid_state`"
  it("answers 409 invalid_state to an answer whose reply_to is not an open or answered question", async () => {
    const decision = await seed(ctx.db, w, "decision", "approved");
    const rejectedQ = await seed(ctx.db, w, "question", "rejected");
    const answeredQ = await seed(ctx.db, w, "question", "answered");
    const before = await snapshot(ctx.db, w.workspaceId);
    for (const t of [decision, rejectedQ]) {
      expectError(
        await owner().post("/api/v1/entries", {
          kind: "answer",
          reply_to: t.id,
          title: "A",
          body: "b",
        }),
        409,
        "invalid_state",
      );
      expectError(
        await owner().post(`/api/v1/entries/${t.id}/answer`, { body: "b" }),
        409,
        "invalid_state",
      );
    }
    expect(await snapshot(ctx.db, w.workspaceId)).toEqual(before);
    const ok = await owner().post(`/api/v1/entries/${answeredQ.id}/answer`, {
      body: "Another answer.",
    });
    expect(ok.status).toBe(201);
    expect(ok.body.question.status).toBe("answered");
  });
});

describe("source", () => {
  // Edge: "Agent sends `source: "human"`; human sends `source: "agent"` | 403 `source_not_allowed`"
  it("answers 403 source_not_allowed to an agent sending source human", async () => {
    const before = await snapshot(ctx.db, w.workspaceId);
    expectError(
      await ctx.server
        .as(agent(w.editor))
        .post("/api/v1/entries", entry(w.proj, "note", { source: "human" })),
      403,
      "source_not_allowed",
    );
    expect(await snapshot(ctx.db, w.workspaceId)).toEqual(before);
  });

  it("answers 403 source_not_allowed to a human sending source agent", async () => {
    expectError(
      await owner().post(
        "/api/v1/entries",
        entry(w.proj, "note", { source: "agent" }),
      ),
      403,
      "source_not_allowed",
    );
  });

  it("defaults source to human for a human and agent for an agent, and takes code and import", async () => {
    expect(
      (await owner().post("/api/v1/entries", entry(w.proj, "note"))).body.entry
        .source,
    ).toBe("human");
    expect(
      (
        await ctx.server
          .as(agent(w.editor))
          .post("/api/v1/entries", entry(w.proj, "note"))
      ).body.entry.source,
    ).toBe("agent");
    for (const source of ["code", "import"]) {
      const h = await owner().post(
        "/api/v1/entries",
        entry(w.proj, "note", { source }),
      );
      expect([h.status, h.body.entry.source, h.body.entry.status]).toEqual([
        201,
        source,
        "approved",
      ]);
      const a = await ctx.server
        .as(agent(w.editor))
        .post("/api/v1/entries", entry(w.proj, "note", { source }));
      expect([a.status, a.body.entry.source, a.body.entry.status]).toEqual([
        201,
        source,
        "proposed",
      ]);
    }
  });
});

describe("search since", () => {
  // Edge: "Search with `since` | only entries whose `seq` is greater, oldest first; a status
  // change gives an entry a new, higher `seq`"
  it("returns only entries with a greater seq, oldest first, and a status change moves an entry's seq", async () => {
    const sw = await seedWorld(ctx.db);
    const c = ctx.server.as(human(sw.owner));
    const first = await c.post("/api/v1/entries", entry(sw.proj, "note"));
    const p = await ctx.server
      .as(agent(sw.editor))
      .post("/api/v1/entries", entry(sw.proj, "decision"));
    const third = await c.post("/api/v1/entries", entry(sw.feat, "lesson"));
    const since = first.body.entry.seq as number;
    expect(p.body.entry.seq).toBeGreaterThan(since);

    const res = await c.get(
      `/api/v1/entries?workspace_id=${sw.workspaceId}&since=${since}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: { id: string }) => e.id)).toEqual([
      p.body.entry.id,
      third.body.entry.id,
    ]);

    const approved = await c.post(`/api/v1/entries/${p.body.entry.id}/approve`);
    expect(approved.body.entry.seq).toBeGreaterThan(third.body.entry.seq);
    const res2 = await c.get(
      `/api/v1/entries?workspace_id=${sw.workspaceId}&since=${third.body.entry.seq}`,
    );
    expect(
      res2.body.entries.map((e: { id: string; status: string }) => [
        e.id,
        e.status,
      ]),
    ).toEqual([[p.body.entry.id, "approved"]]);
  });

  it("orders search newest first without since, and covers the scope's subtree", async () => {
    const sw = await seedWorld(ctx.db);
    const c = ctx.server.as(human(sw.owner));
    const pause = () => new Promise((r) => setTimeout(r, 20));
    const ws = await c.post("/api/v1/entries", entry(sw.ws, "note"));
    await pause();
    const pr = await c.post("/api/v1/entries", entry(sw.proj, "note"));
    await pause();
    const ft = await c.post("/api/v1/entries", entry(sw.feat, "note"));
    const all = await c.get(`/api/v1/entries?workspace_id=${sw.workspaceId}`);
    expect(all.body.entries.map((e: { id: string }) => e.id)).toEqual([
      ft.body.entry.id,
      pr.body.entry.id,
      ws.body.entry.id,
    ]);
    const proj = await c.get(`/api/v1/entries?project_id=${sw.projectId}`);
    expect(proj.body.entries.map((e: { id: string }) => e.id)).toEqual([
      ft.body.entry.id,
      pr.body.entry.id,
    ]);
    const feat = await c.get(`/api/v1/entries?feature_id=${sw.featureId}`);
    expect(feat.body.entries.map((e: { id: string }) => e.id)).toEqual([
      ft.body.entry.id,
    ]);
  });

  it("filters search by kind and status lists", async () => {
    const sw = await seedWorld(ctx.db);
    const c = ctx.server.as(human(sw.owner));
    const note = await c.post("/api/v1/entries", entry(sw.proj, "note"));
    const claim = await c.post("/api/v1/entries", entry(sw.proj, "claim"));
    await c.post("/api/v1/entries", entry(sw.proj, "rule"));
    const byKind = await c.get(
      `/api/v1/entries?project_id=${sw.projectId}&kind=note,claim`,
    );
    expect(byKind.body.entries.map((e: { id: string }) => e.id).sort()).toEqual(
      [note.body.entry.id, claim.body.entry.id].sort(),
    );
    const byStatus = await c.get(
      `/api/v1/entries?project_id=${sw.projectId}&status=proposed`,
    );
    expect(byStatus.body.entries.map((e: { id: string }) => e.id)).toEqual([
      claim.body.entry.id,
    ]);
  });
});

describe("get", () => {
  // Interfaces -> Routes: GET /api/v1/entries/:id answers `{entry, supersedes, superseded_by, answers}`.
  it("returns the supersede chain both ways", async () => {
    const old = await seed(ctx.db, w, "decision", "approved");
    const sup = await owner().post(`/api/v1/entries/${old.id}/supersede`, {
      title: "New",
      body: "b",
    });
    const gotOld = await owner().get(`/api/v1/entries/${old.id}`);
    expect(gotOld.status).toBe(200);
    expect(gotOld.body.superseded_by.map((e: { id: string }) => e.id)).toEqual([
      sup.body.entry.id,
    ]);
    const gotNew = await owner().get(`/api/v1/entries/${sup.body.entry.id}`);
    expect(gotNew.body.supersedes.map((e: { id: string }) => e.id)).toEqual([
      old.id,
    ]);
    expect(gotNew.body.answers).toEqual([]);
  });

  it("an agent can read an entry of its person's workspace", async () => {
    const d = await seed(ctx.db, w, "decision", "approved", {
      authorKind: "agent",
      author: AGENT_ID,
    });
    const res = await ctx.server
      .as(agent(w.viewer))
      .get(`/api/v1/entries/${d.id}`);
    expect(res.status).toBe(200);
    expect(res.body.entry.id).toBe(d.id);
    expect(res.body.entry.quarantined_because).toBeNull();
  });
});
