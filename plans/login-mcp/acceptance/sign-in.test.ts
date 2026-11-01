// Story: A person signs in with Google (allowed people, own workspace, invites, session cookie).
import { describe, expect, it } from "vitest";
import { seedWorkspace } from "../../../apps/server/src/testing/harness.ts";
import { invites, members } from "../../../apps/server/src/db/schema.ts";
import {
  callWhoami,
  connect,
  email,
  expectApiError,
  pathOf,
  setup,
  signIn,
  usersWithEmail,
  type Db,
} from "./helpers.ts";

const BOOTSTRAP = email("boss");
const ANN = email("ann");
const BEN = email("ben");
const CARL = email("carl");
const DORA = email("dora");
const EVE = email("eve");
const FRED = email("fred");
const GINA = email("gina");
const HUGO = email("hugo");
const MIXED_LIST = "Mixed.Case-" + Math.random().toString(36).slice(2, 8) + "@Example.com";
const MIXED_GOOGLE = email("upper");
const INVITE_CASE = email("invcase");

const ctx = setup({
  bootstrapOwnerEmail: BOOTSTRAP.toUpperCase(),
  allowedEmails: [ANN, BEN, CARL, DORA, EVE, FRED, GINA, HUGO, MIXED_LIST, MIXED_GOOGLE, INVITE_CASE],
});

async function membershipsOf(db: Db, userId: string) {
  const rows = await db.select().from(members);
  return rows.filter((r) => r.userId === userId);
}

async function userIdOf(db: Db, address: string): Promise<string> {
  const users = await usersWithEmail(db, address);
  expect(users).toHaveLength(1);
  return users[0]!.id;
}

async function invitedWorkspace(db: Db, invitee: string, role: "editor" | "viewer") {
  const ws = await seedWorkspace(db, {
    name: "Shared " + invitee,
    members: [{ userId: "someOtherOwner" + Math.random().toString(36).slice(2, 10), role: "owner" }],
  });
  const [inv] = await db
    .insert(invites)
    .values({ workspaceId: ws.id, email: invitee, role, invitedBy: "someOtherOwner" })
    .returning();
  return { workspaceId: ws.id, inviteId: inv!.id };
}

async function inviteRow(db: Db, id: string) {
  const rows = await db.select().from(invites);
  return rows.find((r) => r.id === id)!;
}

describe("GET /sign-in", () => {
  // - [ ] `GET /sign-in` answers 200 `text/html` with a "Sign in with Google" button.
  it("GET /sign-in answers 200 text/html with a Sign in with Google button", async () => {
    const server = await ctx.server();
    const res = await server.browser().request("/sign-in");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/^text\/html/);
    expect(res.text).toMatch(/<button[^>]*id="google"/);
    expect(res.text).toContain("Sign in with Google");
  });
});

describe("an allowed person gets their own workspace", () => {
  // - [ ] Signing in with an email in `ALLOWED_EMAILS` or equal to `BOOTSTRAP_OWNER_EMAIL` (any case)
  //       creates that person, one workspace of their own and an `owner` membership in it. Signing in
  //       again creates no second workspace and no second membership.
  it("signing in with an ALLOWED_EMAILS email creates the person, one workspace and an owner membership", async () => {
    const server = await ctx.server();
    await signIn(server, { email: ANN });
    const id = await userIdOf(ctx.db, ANN);
    const rows = await membershipsOf(ctx.db, id);
    expect(rows.map((r) => r.role)).toEqual(["owner"]);
  });

  it("signing in with the BOOTSTRAP_OWNER_EMAIL (another case) creates the person, one workspace and an owner membership", async () => {
    const server = await ctx.server();
    await signIn(server, { email: BOOTSTRAP });
    const id = await userIdOf(ctx.db, BOOTSTRAP);
    const rows = await membershipsOf(ctx.db, id);
    expect(rows.map((r) => r.role)).toEqual(["owner"]);
  });

  // Edge: "A person signs in a second time | No new workspace, no new membership"
  it("signing in again creates no second workspace and no second membership", async () => {
    const server = await ctx.server();
    await signIn(server, { email: BEN });
    const id = await userIdOf(ctx.db, BEN);
    const first = await membershipsOf(ctx.db, id);
    await signIn(server, { email: BEN });
    await signIn(server, { email: BEN });
    expect(await usersWithEmail(ctx.db, BEN)).toHaveLength(1);
    const after = await membershipsOf(ctx.db, id);
    expect(after).toHaveLength(1);
    expect(after[0]!.workspaceId).toBe(first[0]!.workspaceId);
    expect(after[0]!.role).toBe("owner");
  });

  // Edge: "Email in another case (`Ann@X.com` vs `ann@x.com`) on the list or an invite | Matches"
  it("an ALLOWED_EMAILS entry in another case matches the Google email", async () => {
    const server = await ctx.server();
    await signIn(server, { email: MIXED_LIST.toLowerCase() });
    const id = await userIdOf(ctx.db, MIXED_LIST);
    expect((await membershipsOf(ctx.db, id)).map((r) => r.role)).toEqual(["owner"]);
  });

  it("a Google email in another case matches the ALLOWED_EMAILS entry", async () => {
    const server = await ctx.server();
    await signIn(server, { email: MIXED_GOOGLE.toUpperCase() });
    const id = await userIdOf(ctx.db, MIXED_GOOGLE);
    expect((await membershipsOf(ctx.db, id)).map((r) => r.role)).toEqual(["owner"]);
  });

  // Edge: "A person later removed from every workspace, their own included | Next sign-in gives
  // them a new own workspace (no `members` row means first-board rules)"
  it("a person removed from every workspace gets a new own workspace at the next sign-in", async () => {
    const server = await ctx.server();
    await signIn(server, { email: HUGO });
    const id = await userIdOf(ctx.db, HUGO);
    const [old] = await membershipsOf(ctx.db, id);
    await ctx.db.execute(`delete from members where user_id = '${id.replace(/'/g, "''")}'`);
    expect(await membershipsOf(ctx.db, id)).toHaveLength(0);
    await signIn(server, { email: HUGO });
    const after = await membershipsOf(ctx.db, id);
    expect(after.map((r) => r.role)).toEqual(["owner"]);
    expect(after[0]!.workspaceId).not.toBe(old!.workspaceId);
  });
});

describe("two people stay walled off", () => {
  // - [ ] Two allowed people who sign in get two workspaces, and neither can see the other's:
  //       each one's `whoami` (...) lists exactly one workspace, their own as `owner`, and the two
  //       `id`s differ (hard rule 4).
  it("two allowed people each see exactly their own workspace in whoami, with different ids", async () => {
    const server = await ctx.server();
    const a = await callWhoami(server, (await connect(server, { email: CARL })).access_token);
    const b = await callWhoami(server, (await connect(server, { email: DORA })).access_token);
    expect(a.whoami.email).toBe(CARL);
    expect(b.whoami.email).toBe(DORA);
    expect(a.whoami.workspaces).toHaveLength(1);
    expect(b.whoami.workspaces).toHaveLength(1);
    expect(a.whoami.workspaces[0]!.role).toBe("owner");
    expect(b.whoami.workspaces[0]!.role).toBe("owner");
    expect(a.whoami.workspaces[0]!.id).not.toBe(b.whoami.workspaces[0]!.id);
  });
});

describe("invites are accepted at sign-in", () => {
  // - [ ] An allowed person with a pending row in `invites` gets, at sign-in, a `members` row with the
  //       invite's role in that workspace, and the invite's `accepted_at` is set. This holds for a
  //       first sign-in and for a person who already had an account when the invite was made.
  it("a pending invite is accepted at a first sign-in, with the invite's role", async () => {
    const server = await ctx.server();
    const inv = await invitedWorkspace(ctx.db, EVE, "editor");
    await signIn(server, { email: EVE });
    const id = await userIdOf(ctx.db, EVE);
    const rows = await membershipsOf(ctx.db, id);
    expect(rows.find((r) => r.workspaceId === inv.workspaceId)?.role).toBe("editor");
    expect(rows.filter((r) => r.role === "owner")).toHaveLength(1);
    expect((await inviteRow(ctx.db, inv.inviteId)).acceptedAt).toBeInstanceOf(Date);
  });

  // Edge: "Invite made after the person already has an account | Accepted at their next sign-in"
  it("an invite made after the person already had an account is accepted at the next sign-in", async () => {
    const server = await ctx.server();
    await signIn(server, { email: FRED });
    const id = await userIdOf(ctx.db, FRED);
    const inv = await invitedWorkspace(ctx.db, FRED, "viewer");
    expect((await inviteRow(ctx.db, inv.inviteId)).acceptedAt).toBeNull();
    await signIn(server, { email: FRED });
    const rows = await membershipsOf(ctx.db, id);
    expect(rows.find((r) => r.workspaceId === inv.workspaceId)?.role).toBe("viewer");
    expect(rows.filter((r) => r.role === "owner")).toHaveLength(1);
    expect((await inviteRow(ctx.db, inv.inviteId)).acceptedAt).toBeInstanceOf(Date);
  });

  // Edge: "Email in another case ... on the list or an invite | Matches"
  it("an invite whose email is in another case is accepted", async () => {
    const server = await ctx.server();
    const inv = await invitedWorkspace(ctx.db, INVITE_CASE.toUpperCase(), "editor");
    await signIn(server, { email: INVITE_CASE });
    const id = await userIdOf(ctx.db, INVITE_CASE);
    const rows = await membershipsOf(ctx.db, id);
    expect(rows.find((r) => r.workspaceId === inv.workspaceId)?.role).toBe("editor");
    expect((await inviteRow(ctx.db, inv.inviteId)).acceptedAt).toBeInstanceOf(Date);
  });

  // - [ ] `whoami` over `/mcp` with that token returns ... every workspace they are a member of
  //       (their own and those they were invited to) and no other
  // Edge: "A person in several workspaces | `whoami` lists all of them"
  it("whoami lists the own workspace and the invited one, with the invite's role, and no other", async () => {
    const server = await ctx.server();
    const inv = await invitedWorkspace(ctx.db, GINA, "editor");
    const { whoami } = await callWhoami(server, (await connect(server, { email: GINA })).access_token);
    expect(whoami.email).toBe(GINA);
    const byRole = whoami.workspaces.map((w) => w.role).sort();
    expect(byRole).toEqual(["editor", "owner"]);
    expect(whoami.workspaces.find((w) => w.role === "editor")?.id).toBe(inv.workspaceId);
    const id = await userIdOf(ctx.db, GINA);
    const memberIds = (await membershipsOf(ctx.db, id)).map((r) => r.workspaceId).sort();
    expect(whoami.workspaces.map((w) => w.id).sort()).toEqual(memberIds);
  });
});

describe("the session cookie on /api/v1", () => {
  // - [ ] With the session cookie the sign-in set, a request to `/api/v1/<unknown path>` answers
  //       404 (the caller is known); without it, 401 `unauthenticated`.
  it("with the session cookie /api/v1/<unknown path> answers 404", async () => {
    const server = await ctx.server();
    const { browser } = await signIn(server, { email: ANN });
    const res = await browser.request("/api/v1/no-such-route");
    expect(res.status).toBe(404);
  });

  it("without the session cookie /api/v1/<unknown path> answers 401 unauthenticated", async () => {
    const server = await ctx.server();
    const res = await server.browser().request("/api/v1/no-such-route");
    expectApiError(res, 401, "unauthenticated");
  });

  // Edge: "`X-Dev-Actor` with the dev header off | Still 401 `dev_actor_disabled` (D15), even with
  // a valid session"
  it("X-Dev-Actor with the dev header off answers 401 dev_actor_disabled even with a valid session", async () => {
    const server = await ctx.server();
    const { browser, callback } = await signIn(server, { email: ANN });
    expect(pathOf(server, callback.next)).not.toMatch(/error=/);
    const res = await browser.request("/api/v1/no-such-route", {
      headers: { "x-dev-actor": JSON.stringify({ kind: "human", user_id: "someoneElse" }) },
    });
    expectApiError(res, 401, "dev_actor_disabled");
  });
});
