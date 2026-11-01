// Edge cases about the request: scope ids, JSON, path ids, titles and the size caps.
import { beforeAll, describe, expect, it } from "vitest";
import {
  agent,
  entry,
  expectError,
  expectStatus,
  human,
  seed,
  seedWorld,
  setup,
  snapshot,
  uid,
  utf8Bytes,
  type World,
} from "./helpers.ts";

const ctx = setup();
let w: World;
let other: World;
const missing = "00000000-0000-4000-8000-00000000abcd";

beforeAll(async () => {
  w = await seedWorld(ctx.db);
  other = await seedWorld(ctx.db);
}, 60_000);

const owner = () => ctx.server.as(human(w.owner));

describe("scope ids", () => {
  // Edge: "Two scope ids in one request, or none | 400 `invalid_request`"
  it("answers 400 invalid_request to a write with two scope ids", async () => {
    const res = await owner().post(
      "/api/v1/entries",
      entry({ ...w.ws, ...w.proj }, "note"),
    );
    expectError(res, 400, "invalid_request");
  });

  it("answers 400 invalid_request to a write with no scope id", async () => {
    expectError(
      await owner().post("/api/v1/entries", entry({}, "note")),
      400,
      "invalid_request",
    );
    const { scope: _s, ...noScope } = entry(w.proj, "note");
    expectError(
      await owner().post("/api/v1/entries", noScope),
      400,
      "invalid_request",
    );
  });

  it("answers 400 invalid_request to a search with two scope ids or none", async () => {
    expectError(
      await owner().get(
        `/api/v1/entries?project_id=${w.projectId}&feature_id=${w.featureId}`,
      ),
      400,
      "invalid_request",
    );
    expectError(await owner().get("/api/v1/entries"), 400, "invalid_request");
  });

  it("answers 400 invalid_request to ask and context with two scope ids", async () => {
    expectError(
      await owner().post("/api/v1/ask", {
        scope: { ...w.proj, ...w.feat },
        title: "Q?",
        body: "b",
      }),
      400,
      "invalid_request",
    );
    expectError(
      await owner().post("/api/v1/context", { scope: { ...w.ws, ...w.feat } }),
      400,
      "invalid_request",
    );
  });

  // Edge: "Scope id of a workspace the caller is not a member of, or that does not exist |
  // 404 `not_found` (never 403, so existence is not revealed)"
  it("answers 404 not_found for a scope in a workspace the caller is not a member of", async () => {
    const before = await snapshot(ctx.db, other.workspaceId);
    expectError(
      await owner().post("/api/v1/entries", entry(other.proj, "note")),
      404,
      "not_found",
    );
    expectError(
      await owner().get(`/api/v1/entries?workspace_id=${other.workspaceId}`),
      404,
      "not_found",
    );
    expectError(
      await owner().post("/api/v1/context", { scope: other.feat }),
      404,
      "not_found",
    );
    expect(await snapshot(ctx.db, other.workspaceId)).toEqual(before);
  });

  it("answers 404 not_found for a scope id that does not exist", async () => {
    expectError(
      await owner().post(
        "/api/v1/entries",
        entry({ project_id: missing }, "note"),
      ),
      404,
      "not_found",
    );
    expectError(
      await owner().get(`/api/v1/entries?feature_id=${missing}`),
      404,
      "not_found",
    );
    expectError(
      await owner().post("/api/v1/context", {
        scope: { workspace_id: missing },
      }),
      404,
      "not_found",
    );
  });

  it("answers 404 not_found to a user who is a member of no workspace", async () => {
    const res = await ctx.server
      .as(human(w.outsider))
      .post("/api/v1/entries", entry(w.proj, "note"));
    expectError(res, 404, "not_found");
  });
});

describe("JSON body", () => {
  // Edge: "Malformed JSON body | 400 `invalid_json`"
  it("answers 400 invalid_json to a malformed JSON body", async () => {
    const res = await owner().request("/api/v1/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"scope": {',
    });
    expectError(res, 400, "invalid_json");
  });

  // Edge: "A write with no JSON body (or another content type) | 400 `invalid_request`"
  it("answers 400 invalid_request to a write with no body", async () => {
    expectError(await owner().post("/api/v1/entries"), 400, "invalid_request");
  });

  it("answers 400 invalid_request to a write with another content type", async () => {
    const res = await owner().request("/api/v1/entries", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(entry(w.proj, "note")),
    });
    expectError(res, 400, "invalid_request");
  });

  // Edge: "JSON body over 64 KB | 413 `too_large`"
  // Story: "A JSON body over 64 KB gets 413 `too_large` with no `field`."
  it("answers 413 too_large with no field to a JSON body over 64 KB", async () => {
    const before = await snapshot(ctx.db, w.workspaceId);
    const res = await owner().post(
      "/api/v1/entries",
      entry(w.proj, "note", { body: "x".repeat(70 * 1024) }),
    );
    expectError(res, 413, "too_large");
    expect(res.body.error.field).toBeUndefined();
    expect(await snapshot(ctx.db, w.workspaceId)).toEqual(before);
  });
});

describe("path ids", () => {
  // Edge: "A path `:id` that is not a uuid | 400 `invalid_request` (an agent on a humans-only
  // route gets `humans_only` first)"
  it("answers 400 invalid_request to a path id that is not a uuid", async () => {
    expectError(
      await owner().get("/api/v1/entries/not-a-uuid"),
      400,
      "invalid_request",
    );
    expectError(
      await owner().post("/api/v1/entries/not-a-uuid/supersede", {
        title: "t",
        body: "b",
      }),
      400,
      "invalid_request",
    );
    for (const action of ["approve", "reject", "release"]) {
      expectError(
        await owner().post(`/api/v1/entries/123/${action}`),
        400,
        "invalid_request",
      );
    }
    expectError(
      await owner().post("/api/v1/entries/123/answer", { body: "b" }),
      400,
      "invalid_request",
    );
    expectError(
      await owner().get("/api/v1/workspaces/abc/export"),
      400,
      "invalid_request",
    );
    expectError(
      await owner().delete("/api/v1/workspaces/abc", { confirm: w.name }),
      400,
      "invalid_request",
    );
  });

  it("answers humans_only first to an agent on a humans-only route with a bad path id", async () => {
    const a = ctx.server.as(agent(w.owner));
    for (const action of ["approve", "reject", "release"]) {
      expectError(
        await a.post(`/api/v1/entries/123/${action}`),
        403,
        "humans_only",
      );
    }
    expectError(
      await a.post("/api/v1/entries/123/answer", { body: "b" }),
      403,
      "humans_only",
    );
    expectError(
      await a.get("/api/v1/workspaces/abc/export"),
      403,
      "humans_only",
    );
    expectError(
      await a.delete("/api/v1/workspaces/abc", { confirm: "x" }),
      403,
      "humans_only",
    );
  });
});

describe("title", () => {
  // Edge: "Title with a newline or control character | 400 `invalid_request`"
  it("answers 400 invalid_request to a title with a newline", async () => {
    expectError(
      await owner().post(
        "/api/v1/entries",
        entry(w.proj, "note", { title: "one\ntwo" }),
      ),
      400,
      "invalid_request",
    );
  });

  it("answers 400 invalid_request to a title with a control character", async () => {
    expectError(
      await owner().post(
        "/api/v1/entries",
        entry(w.proj, "note", { title: "bell\u0007" }),
      ),
      400,
      "invalid_request",
    );
    expectError(
      await owner().post(
        "/api/v1/entries",
        entry(w.proj, "note", { title: "tab\there" }),
      ),
      400,
      "invalid_request",
    );
  });
});

describe("size caps", () => {
  // Story: "A title over 200 characters, a body over 16,384 UTF-8 bytes, more than 50 refs or a ref
  // over 2,048 characters gets 413 `too_large` whose `field` names the value over the cap"
  // Edge: "Title 201 chars; body 16,385 bytes (multi-byte text counts bytes); 51 refs | 413
  // `too_large` with `field` `title`, `body` or `refs`"
  it("answers 413 too_large field title to a 201-character title, and takes 200", async () => {
    const before = await snapshot(ctx.db, w.workspaceId);
    const res = await owner().post(
      "/api/v1/entries",
      entry(w.proj, "note", { title: "t".repeat(201) }),
    );
    expectError(res, 413, "too_large");
    expect(res.body.error.field).toBe("title");
    expect(await snapshot(ctx.db, w.workspaceId)).toEqual(before);
    expectStatus(
      await owner().post(
        "/api/v1/entries",
        entry(w.proj, "note", { title: "t".repeat(200) }),
      ),
      201,
    );
  });

  it("answers 413 too_large field body to a 16,385-byte multi-byte body, and takes 16,384", async () => {
    const atCap = "é".repeat(8192);
    expect(utf8Bytes(atCap)).toBe(16384);
    expectStatus(
      await owner().post(
        "/api/v1/entries",
        entry(w.proj, "note", { body: atCap }),
      ),
      201,
    );
    const res = await owner().post(
      "/api/v1/entries",
      entry(w.proj, "note", { body: atCap + "a" }),
    );
    expectError(res, 413, "too_large");
    expect(res.body.error.field).toBe("body");
    // 8,193 characters but 16,386 bytes: bytes count, not characters.
    const res2 = await owner().post(
      "/api/v1/entries",
      entry(w.proj, "note", { body: "é".repeat(8193) }),
    );
    expectError(res2, 413, "too_large");
    expect(res2.body.error.field).toBe("body");
  });

  it("answers 413 too_large field refs to 51 refs, and takes 50", async () => {
    const refs = (n: number) =>
      Array.from({ length: n }, (_, i) => `https://example.com/r/${i}`);
    expectStatus(
      await owner().post(
        "/api/v1/entries",
        entry(w.proj, "note", { refs: refs(50) }),
      ),
      201,
    );
    const res = await owner().post(
      "/api/v1/entries",
      entry(w.proj, "note", { refs: refs(51) }),
    );
    expectError(res, 413, "too_large");
    expect(res.body.error.field).toBe("refs");
  });

  // Edge: "The fourth ref is 2,049 characters long | 413 `too_large` with `field` `refs.3`"
  it("answers 413 too_large field refs.3 when the fourth ref is 2,049 characters", async () => {
    const long = "https://example.com/" + "a".repeat(2049 - 20);
    expect(long.length).toBe(2049);
    const res = await owner().post(
      "/api/v1/entries",
      entry(w.proj, "note", { refs: ["a", "b", "c", long] }),
    );
    expectError(res, 413, "too_large");
    expect(res.body.error.field).toBe("refs.3");
  });

  it("names the lowest index when several refs are too long, and takes a 2,048-character ref", async () => {
    const long = "r".repeat(2049);
    const res = await owner().post(
      "/api/v1/entries",
      entry(w.proj, "note", { refs: ["a", long, "c", long] }),
    );
    expectError(res, 413, "too_large");
    expect(res.body.error.field).toBe("refs.1");
    expectStatus(
      await owner().post(
        "/api/v1/entries",
        entry(w.proj, "note", { refs: ["r".repeat(2048)] }),
      ),
      201,
    );
  });

  it("gives the first cap broken, in the order title, body, refs", async () => {
    const res = await owner().post(
      "/api/v1/entries",
      entry(w.proj, "note", {
        title: "t".repeat(201),
        body: "b".repeat(16385),
        refs: Array(51).fill("x"),
      }),
    );
    expectError(res, 413, "too_large");
    expect(res.body.error.field).toBe("title");
    const res2 = await owner().post(
      "/api/v1/entries",
      entry(w.proj, "note", {
        body: "b".repeat(16385),
        refs: Array(51).fill("x"),
      }),
    );
    expect(res2.body.error.field).toBe("body");
  });

  it("applies the caps on ask, supersede and the answer route", async () => {
    const ask = await owner().post("/api/v1/ask", {
      scope: w.proj,
      title: "q".repeat(201),
      body: "b",
    });
    expectError(ask, 413, "too_large");
    expect(ask.body.error.field).toBe("title");

    const decision = await seed(ctx.db, w, "decision", "approved");
    const sup = await owner().post(`/api/v1/entries/${decision.id}/supersede`, {
      title: "New",
      body: "b".repeat(16385),
    });
    expectError(sup, 413, "too_large");
    expect(sup.body.error.field).toBe("body");

    const question = await seed(ctx.db, w, "question", "open");
    const ans = await owner().post(`/api/v1/entries/${question.id}/answer`, {
      body: "b",
      refs: Array(51).fill("x"),
    });
    expectError(ans, 413, "too_large");
    expect(ans.body.error.field).toBe("refs");
  });

  // Interfaces -> Size caps: "A size cap answers before any other problem of step 5"
  it("answers the size cap before another request-shape problem", async () => {
    const res = await owner().post("/api/v1/entries", {
      scope: { ...w.ws, ...w.proj },
      kind: "note",
      title: "t".repeat(201),
      body: "b",
    });
    expectError(res, 413, "too_large");
    expect(res.body.error.field).toBe("title");
  });

  // Interfaces -> Check order: step 5 (request shape) comes before step 6 (membership).
  it("answers the size cap before membership", async () => {
    const res = await owner().post(
      "/api/v1/entries",
      entry(other.proj, "note", { title: "t".repeat(201) }),
    );
    expectError(res, 413, "too_large");
  });
});

describe("other limits", () => {
  // Interfaces -> Size caps: "Every other limit (`task`, `q`, `budget`, `limit`, ...) is 400 `invalid_request`."
  it("answers 400 invalid_request to a search limit outside 1..100", async () => {
    expectError(
      await owner().get(`/api/v1/entries?project_id=${w.projectId}&limit=101`),
      400,
      "invalid_request",
    );
    expectError(
      await owner().get(`/api/v1/entries?project_id=${w.projectId}&limit=0`),
      400,
      "invalid_request",
    );
  });

  it("answers 400 invalid_request to a context task over 2,000 characters", async () => {
    expectError(
      await owner().post("/api/v1/context", {
        scope: w.proj,
        task: "a".repeat(2001),
      }),
      400,
      "invalid_request",
    );
  });

  it("answers 400 invalid_request to an unknown kind", async () => {
    expectError(
      await owner().post("/api/v1/entries", entry(w.proj, "memo")),
      400,
      "invalid_request",
    );
  });

  it("does not store a write with a unique title that was refused", async () => {
    const title = uid("Refused");
    await owner().post(
      "/api/v1/entries",
      entry({ ...w.ws, ...w.proj }, "note", { title }),
    );
    const res = await owner().get(
      `/api/v1/entries?workspace_id=${w.workspaceId}&limit=100`,
    );
    expect(res.status).toBe(200);
    expect(
      res.body.entries.map((e: { title: string }) => e.title),
    ).not.toContain(title);
  });
});
