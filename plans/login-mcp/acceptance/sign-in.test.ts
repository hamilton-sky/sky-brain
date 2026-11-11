// Story: A person signs in with Perminister (own workspace, invites, session cookie).
import { describe, expect, it } from "vitest";
import { seedWorkspace } from "../../../apps/server/src/testing/harness.ts";
import { invites, members } from "../../../apps/server/src/db/schema.ts";
import {
  account,
  accountsForSubject,
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

const ANN = account(email("ann"));
const BEN = account(email("ben"));
const CARL = account(email("carl"));
const DORA = account(email("dora"));
const EVE = account(email("eve"));
const FRED = account(email("fred"));
const GINA = account(email("gina"));
const HUGO = account(email("hugo"));
const SAME = account(email("same"));
const UPPER = account(email("upper").toUpperCase());
const INVITE_CASE = account(email("invcase"));
const INVITE_UPPER = account(email("invupper").toUpperCase());

const ctx = setup();

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
  // - [ ] `GET /sign-in` answers 200 `text/html` with a "Sign in with Perminister" button.
  // Interfaces: "`GET /sign-in` (any query) answers HTML holding a button `id="perminister"`"
  it("GET /sign-in answers 200 text/html with a Sign in with Perminister button", async () => {
    const server = await ctx.server();
    const res = await server.browser().request("/sign-in");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/^text\/html/);
    expect(res.text).toMatch(/<button[^>]*id="perminister"/);
    expect(res.text).toContain("Sign in with Perminister");
  });
});

describe("a person with sky-brain access gets their own workspace", () => {
  // - [ ] Signing in with a Perminister account whose token exchange lists an organization for
  //       product `sky-brain` creates that person (a `user` row, and an `account` row with
  //       `provider_id` `perminister` and `account_id` equal to the Perminister `subjectId`; ...),
  //       one workspace of their own and an `owner` membership in it. Signing in again creates no
  //       second user, workspace or membership.
  it("signing in with sky-brain access creates the user, a perminister account row, one workspace and an owner membership", async () => {
    const server = await ctx.server();
    const { callback } = await signIn(server, ANN);
    expect(pathOf(server, callback.next)).not.toMatch(/error=/);
    const id = await userIdOf(ctx.db, ANN.email!);
    const accounts = await accountsForSubject(ctx.db, ANN.subjectId);
    expect(accounts).toEqual([
      { user_id: id, provider_id: "perminister", account_id: ANN.subjectId },
    ]);
    const rows = await membershipsOf(ctx.db, id);
    expect(rows.map((r) => r.role)).toEqual(["owner"]);
  });

  // Edge: "A person signs in a second time | No new workspace, no new membership"
  it("signing in again creates no second user, workspace or membership", async () => {
    const server = await ctx.server();
    await signIn(server, BEN);
    const id = await userIdOf(ctx.db, BEN.email!);
    const first = await membershipsOf(ctx.db, id);
    await signIn(server, BEN);
    await signIn(server, BEN);
    expect(await usersWithEmail(ctx.db, BEN.email!)).toHaveLength(1);
    const after = await membershipsOf(ctx.db, id);
    expect(after).toHaveLength(1);
    expect(after[0]!.workspaceId).toBe(first[0]!.workspaceId);
    expect(after[0]!.role).toBe("owner");
  });

  // Edge: "Same Perminister `subjectId` signs in again | Same user (the `account` row is keyed by
  // `subjectId`), no new workspace"
  it("the same Perminister subjectId signing in again is the same user with no new workspace", async () => {
    const server = await ctx.server();
    await signIn(server, SAME);
    const [before] = await accountsForSubject(ctx.db, SAME.subjectId);
    expect(before).toBeTruthy();
    const ownBefore = await membershipsOf(ctx.db, before!.user_id);
    await signIn(server, { ...SAME });
    const after = await accountsForSubject(ctx.db, SAME.subjectId);
    expect(after).toHaveLength(1);
    expect(after[0]!.user_id).toBe(before!.user_id);
    expect(await membershipsOf(ctx.db, before!.user_id)).toEqual(ownBefore);
  });

  // Edge: "Email in another case (`Ann@X.com` vs `ann@x.com`) in Perminister or an invite | Matches"
  it("a Perminister email in upper case signs in as one person with one own workspace", async () => {
    const server = await ctx.server();
    await signIn(server, UPPER);
    await signIn(server, UPPER);
    const id = await userIdOf(ctx.db, UPPER.email!);
    expect((await membershipsOf(ctx.db, id)).map((r) => r.role)).toEqual(["owner"]);
  });

  // Edge: "A person later removed from every workspace, their own included | Next sign-in gives
  // them a new own workspace (no `members` row means first-board rules)"
  it("a person removed from every workspace gets a new own workspace at the next sign-in", async () => {
    const server = await ctx.server();
    await signIn(server, HUGO);
    const id = await userIdOf(ctx.db, HUGO.email!);
    const [old] = await membershipsOf(ctx.db, id);
    await ctx.db.execute(`delete from members where user_id = '${id.replace(/'/g, "''")}'`);
    expect(await membershipsOf(ctx.db, id)).toHaveLength(0);
    await signIn(server, HUGO);
    const after = await membershipsOf(ctx.db, id);
    expect(after.map((r) => r.role)).toEqual(["owner"]);
    expect(after[0]!.workspaceId).not.toBe(old!.workspaceId);
  });
});

describe("two people stay walled off", () => {
  // - [ ] Two such people who sign in get two workspaces, and neither can see the other's:
  //       each one's `whoami` (...) lists exactly one workspace, their own as `owner`, and the two
  //       `id`s differ (hard rule 4).
  it("two people with access each see exactly their own workspace in whoami, with different ids", async () => {
    const server = await ctx.server();
    const a = await callWhoami(server, (await connect(server, CARL)).access_token);
    const b = await callWhoami(server, (await connect(server, DORA)).access_token);
    expect(a.whoami.email).toBe(CARL.email);
    expect(b.whoami.email).toBe(DORA.email);
    expect(a.whoami.workspaces).toHaveLength(1);
    expect(b.whoami.workspaces).toHaveLength(1);
    expect(a.whoami.workspaces[0]!.role).toBe("owner");
    expect(b.whoami.workspaces[0]!.role).toBe("owner");
    expect(a.whoami.workspaces[0]!.id).not.toBe(b.whoami.workspaces[0]!.id);
  });
});

describe("invites are accepted at sign-in", () => {
  // - [ ] A person with a pending row in `invites` (matched on their Perminister email, any case) gets, at sign-in, a `members` row with the
  //       invite's role in that workspace, and the invite's `accepted_at` is set. This holds for a
  //       first sign-in and for a person who already had an account when the invite was made.
  it("a pending invite is accepted at a first sign-in, with the invite's role", async () => {
    const server = await ctx.server();
    const inv = await invitedWorkspace(ctx.db, EVE.email!, "editor");
    await signIn(server, EVE);
    const id = await userIdOf(ctx.db, EVE.email!);
    const rows = await membershipsOf(ctx.db, id);
    expect(rows.find((r) => r.workspaceId === inv.workspaceId)?.role).toBe("editor");
    expect(rows.filter((r) => r.role === "owner")).toHaveLength(1);
    expect((await inviteRow(ctx.db, inv.inviteId)).acceptedAt).toBeInstanceOf(Date);
  });

  // Edge: "Invite made after the person already has an account | Accepted at their next sign-in"
  it("an invite made after the person already had an account is accepted at the next sign-in", async () => {
    const server = await ctx.server();
    await signIn(server, FRED);
    const id = await userIdOf(ctx.db, FRED.email!);
    const inv = await invitedWorkspace(ctx.db, FRED.email!, "viewer");
    expect((await inviteRow(ctx.db, inv.inviteId)).acceptedAt).toBeNull();
    await signIn(server, FRED);
    const rows = await membershipsOf(ctx.db, id);
    expect(rows.find((r) => r.workspaceId === inv.workspaceId)?.role).toBe("viewer");
    expect(rows.filter((r) => r.role === "owner")).toHaveLength(1);
    expect((await inviteRow(ctx.db, inv.inviteId)).acceptedAt).toBeInstanceOf(Date);
  });

  // Edge: "Email in another case (`Ann@X.com` vs `ann@x.com`) in Perminister or an invite | Matches"
  it("an invite whose email is in upper case is accepted for the lower-case Perminister email", async () => {
    const server = await ctx.server();
    const inv = await invitedWorkspace(ctx.db, INVITE_CASE.email!.toUpperCase(), "editor");
    await signIn(server, INVITE_CASE);
    const id = await userIdOf(ctx.db, INVITE_CASE.email!);
    const rows = await membershipsOf(ctx.db, id);
    expect(rows.find((r) => r.workspaceId === inv.workspaceId)?.role).toBe("editor");
    expect((await inviteRow(ctx.db, inv.inviteId)).acceptedAt).toBeInstanceOf(Date);
  });

  it("a lower-case invite is accepted for an upper-case Perminister email", async () => {
    const server = await ctx.server();
    const inv = await invitedWorkspace(ctx.db, INVITE_UPPER.email!.toLowerCase(), "viewer");
    await signIn(server, INVITE_UPPER);
    const id = await userIdOf(ctx.db, INVITE_UPPER.email!);
    const rows = await membershipsOf(ctx.db, id);
    expect(rows.find((r) => r.workspaceId === inv.workspaceId)?.role).toBe("viewer");
    expect((await inviteRow(ctx.db, inv.inviteId)).acceptedAt).toBeInstanceOf(Date);
  });

  // - [ ] `whoami` over `/mcp` with that token returns ... every workspace they are a member of
  //       (their own and those they were invited to) and no other
  // Edge: "A person in several workspaces | `whoami` lists all of them"
  it("whoami lists the own workspace and the invited one, with the invite's role, and no other", async () => {
    const server = await ctx.server();
    const inv = await invitedWorkspace(ctx.db, GINA.email!, "editor");
    const { whoami } = await callWhoami(server, (await connect(server, GINA)).access_token);
    expect(whoami.email).toBe(GINA.email);
    const byRole = whoami.workspaces.map((w) => w.role).sort();
    expect(byRole).toEqual(["editor", "owner"]);
    expect(whoami.workspaces.find((w) => w.role === "editor")?.id).toBe(inv.workspaceId);
    const id = await userIdOf(ctx.db, GINA.email!);
    const memberIds = (await membershipsOf(ctx.db, id)).map((r) => r.workspaceId).sort();
    expect(whoami.workspaces.map((w) => w.id).sort()).toEqual(memberIds);
  });
});

describe("the session cookie on /api/v1", () => {
  // - [ ] With the session cookie the sign-in set, a request to `/api/v1/<unknown path>` answers
  //       404 (the caller is known); without it, 401 `unauthenticated`.
  it("with the session cookie /api/v1/<unknown path> answers 404", async () => {
    const server = await ctx.server();
    const { browser } = await signIn(server, ANN);
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
    const { browser, callback } = await signIn(server, ANN);
    expect(pathOf(server, callback.next)).not.toMatch(/error=/);
    const res = await browser.request("/api/v1/no-such-route", {
      headers: { "x-dev-actor": JSON.stringify({ kind: "human", user_id: "someoneElse" }) },
    });
    expectApiError(res, 401, "dev_actor_disabled");
  });
});
