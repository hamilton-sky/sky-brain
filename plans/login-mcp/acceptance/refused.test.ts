// Story: A person signs in with Perminister — everyone Perminister has not let into `sky-brain`,
// and every forged or refused callback, gets no user and no session.
import { describe, expect, it } from "vitest";
import { seedWorkspace } from "../../../apps/server/src/testing/harness.ts";
import { invites } from "../../../apps/server/src/db/schema.ts";
import {
  account,
  accountsForSubject,
  authorizeQuery,
  email,
  expectApiError,
  finishPerministerSignIn,
  getCode,
  pathOf,
  perministerSignIn,
  pkce,
  queryOf,
  sessionCount,
  setup,
  signIn,
  startPerministerSignIn,
  userCount,
  usersWithEmail,
  type AuthServer,
  type Browser,
  type PerministerAccount,
  type Res,
} from "./helpers.ts";

const ctx = setup();

function expectLanding(server: AuthServer, res: Res, error: string): void {
  expect(pathOf(server, res.next)).toMatch(new RegExp(`^/sign-in\\?(.*&)?error=${error}(&|$)`));
}

async function expectNoSession(server: AuthServer, browser: Browser, sessionsBefore: number) {
  expect(await sessionCount(ctx.db)).toBe(sessionsBefore);
  expectApiError(await browser.request("/api/v1/no-such-route"), 401, "unauthenticated");
}

async function expectNoAccessPage(server: AuthServer, res: Res): Promise<void> {
  const page = await server.browser().request(pathOf(server, res.next));
  expect(page.status).toBe(200);
  expect(page.text).toContain('id="no-access"');
  expect(page.text).toContain("No access");
}

/** Signs in and checks the refusal: no user, no session, a "No access" landing. */
async function expectRefused(
  server: AuthServer,
  who: PerministerAccount,
  opts: { error?: string; existingUser?: boolean } = {},
) {
  const sessionsBefore = await sessionCount(ctx.db);
  const usersBefore = await userCount(ctx.db);
  const accountsBefore = await accountsForSubject(ctx.db, who.subjectId);
  const { browser, callback } = await signIn(server, who);
  expectLanding(server, callback, opts.error ?? "no_access");
  await expectNoSession(server, browser, sessionsBefore);
  expect(await userCount(ctx.db)).toBe(usersBefore);
  expect(await accountsForSubject(ctx.db, who.subjectId)).toEqual(accountsBefore);
  if (!opts.existingUser) expect(accountsBefore).toEqual([]);
  await expectNoAccessPage(server, callback);
}

describe("No access", () => {
  // - [ ] A Perminister account with no organization for product `sky-brain` creates no user and no
  //       session: the browser lands on `/sign-in?error=no_access` and the page says "No access".
  // Edge: "Perminister account with no organization for product `sky-brain` | No user, no
  // session; `/sign-in?error=no_access` shows "No access""
  it("an account with no organization creates no user and no session and lands on /sign-in?error=no_access", async () => {
    const server = await ctx.server();
    const who = account(email("noorg"), { productIds: [] });
    await expectRefused(server, who);
    expect(await usersWithEmail(ctx.db, who.email!)).toEqual([]);
  });

  it("an account whose only organization is for another product is refused the same way", async () => {
    const server = await ctx.server();
    const who = account(email("otherproduct"), { productIds: ["some-other-product"] });
    await expectRefused(server, who);
    expect(await usersWithEmail(ctx.db, who.email!)).toEqual([]);
  });

  // - [ ] ... A pending invite for its email stays pending.
  // Edge: "Such an account with a pending invite | Same as above; the invite stays pending"
  it("an account with no sky-brain organization but a pending invite is refused and the invite stays pending", async () => {
    const server = await ctx.server();
    const who = account(email("inviteonly"), { productIds: [] });
    const ws = await seedWorkspace(ctx.db, {
      name: "Invite only",
      members: [{ userId: "inviteOnlyOwner", role: "owner" }],
    });
    const [inv] = await ctx.db
      .insert(invites)
      .values({ workspaceId: ws.id, email: who.email!, role: "editor", invitedBy: "inviteOnlyOwner" })
      .returning();
    await expectRefused(server, who);
    const rows = await ctx.db.select().from(invites);
    expect(rows.find((r) => r.id === inv!.id)?.acceptedAt).toBeNull();
  });

  // - [ ] A Perminister account with no email creates no user and no session: the browser lands on
  //       `/sign-in?error=email_not_found` and the page says "No access".
  // Edge: "Perminister account with no email | No user, no session;
  // `/sign-in?error=email_not_found` shows "No access""
  it("an account with no email creates no user and no session and lands on /sign-in?error=email_not_found", async () => {
    const server = await ctx.server();
    await expectRefused(server, account(null), { error: "email_not_found" });
  });

  // Same rule inside the OAuth flow: a refused person never reaches consent or the client.
  it("a refused account in the OAuth flow lands on /sign-in?error=no_access and gets no code", async () => {
    const server = await ctx.server();
    const b = server.browser();
    const auth = await b.request(
      "/api/auth/oauth2/authorize?" + authorizeQuery(server, { challenge: pkce().challenge }),
    );
    const toSignIn = pathOf(server, auth.next);
    expect(toSignIn.startsWith("/sign-in?")).toBe(true);
    const sessionsBefore = await sessionCount(ctx.db);
    const cb = await perministerSignIn(
      server,
      b,
      account(email("oauthnoorg"), { productIds: [] }),
      queryOf(toSignIn),
    );
    expectLanding(server, cb, "no_access");
    expect(pathOf(server, cb.next)).not.toContain("code=");
    await expectNoSession(server, b, sessionsBefore);
  });

  // - [ ] A person whose `sky-brain` access was taken away in Perminister gets "No access" at their
  //       next sign-in.
  // Edge: "`sky-brain` access taken away in Perminister later | "No access" at the next sign-in"
  it("a person whose sky-brain access was taken away gets No access at their next sign-in", async () => {
    const server = await ctx.server();
    const who = account(email("removed"));
    const first = await signIn(server, who);
    expect(pathOf(server, first.callback.next)).not.toMatch(/error=/);
    expect(await usersWithEmail(ctx.db, who.email!)).toHaveLength(1);
    await expectRefused(server, { ...who, productIds: [] }, { existingUser: true });
  });

  it("a person who keeps sky-brain access keeps getting in (control for the case above)", async () => {
    const server = await ctx.server();
    const c = await getCode(server, account(email("kept")));
    expect(c.code).toBeTruthy();
  });
});

describe("forged and refused Perminister callbacks", () => {
  /** Starts a sign-in and returns Perminister's callback path (`code` and `state`) without using it. */
  async function approved(server: AuthServer, b: Browser, who: PerministerAccount) {
    server.setPerministerAccount(who);
    const authorizeUrl = await startPerministerSignIn(server, b);
    const path = server.approve(authorizeUrl);
    const q = new URL(path, server.url).searchParams;
    return { authorizeUrl, path, code: q.get("code")!, state: q.get("state")! };
  }

  // - [ ] A Perminister callback with a forged `state`, or with a code Perminister refuses (reused,
  //       expired, wrong PKCE verifier), creates no session.
  // Edge: "Callback with a forged or missing `state` | Better Auth's error page
  // (`error=state_mismatch`); no session"
  it("a callback with a forged state creates no session and ends with error=state_mismatch", async () => {
    const server = await ctx.server();
    const b = server.browser();
    const { code } = await approved(server, b, account(email("forged")));
    const sessionsBefore = await sessionCount(ctx.db);
    const res = await b.request(
      `/api/auth/callback/perminister?code=${encodeURIComponent(code)}&state=forged-${Date.now()}`,
    );
    expect(res.next ?? "").toContain("error=state_mismatch");
    await expectNoSession(server, b, sessionsBefore);
  });

  it("a callback with no state creates no session and ends with error=state_mismatch", async () => {
    const server = await ctx.server();
    const b = server.browser();
    const { code } = await approved(server, b, account(email("nostate")));
    const sessionsBefore = await sessionCount(ctx.db);
    const res = await b.request(`/api/auth/callback/perminister?code=${encodeURIComponent(code)}`);
    expect(res.next ?? "").toContain("error=state_mismatch");
    await expectNoSession(server, b, sessionsBefore);
  });

  // Edge: "Perminister refuses the code (reused, older than 5 minutes, wrong verifier) or does not
  // answer within 10 s | `/sign-in?error=invalid_code`; no session"
  it("a reused Perminister code creates no session and lands on /sign-in?error=invalid_code", async () => {
    const server = await ctx.server();
    const who = account(email("reused"));
    const first = server.browser();
    const used = await approved(server, first, who);
    const ok = await first.request(used.path);
    expect(pathOf(server, ok.next).startsWith("/api/auth/callback/perminister?")).toBe(true);
    await first.request(pathOf(server, ok.next));
    // A new sign-in in a fresh browser (a fresh state), answered with the code already spent.
    const b = server.browser();
    const fresh = await approved(server, b, who);
    const sessionsBefore = await sessionCount(ctx.db);
    const res = await b.request(
      `/api/auth/callback/perminister?code=${encodeURIComponent(used.code)}&state=${encodeURIComponent(fresh.state)}`,
    );
    expectLanding(server, res, "invalid_code");
    await expectNoSession(server, b, sessionsBefore);
  });

  it("a Perminister code bound to another PKCE challenge creates no session and lands on /sign-in?error=invalid_code", async () => {
    const server = await ctx.server();
    const who = account(email("wrongverifier"));
    // A code issued for one sign-in (its own challenge), never exchanged.
    const other = await approved(server, server.browser(), who);
    // Swapped into another sign-in, whose verifier does not match that challenge.
    const b = server.browser();
    const mine = await approved(server, b, who);
    const sessionsBefore = await sessionCount(ctx.db);
    const res = await b.request(
      `/api/auth/callback/perminister?code=${encodeURIComponent(other.code)}&state=${encodeURIComponent(mine.state)}`,
    );
    expectLanding(server, res, "invalid_code");
    await expectNoSession(server, b, sessionsBefore);
    expect(await accountsForSubject(ctx.db, who.subjectId)).toEqual([]);
  });

  // Control: the same steps with the matching code do sign in.
  it("the matching code and state do sign in (control for the cases above)", async () => {
    const server = await ctx.server();
    const b = server.browser();
    const who = account(email("matching"));
    server.setPerministerAccount(who);
    const res = await finishPerministerSignIn(server, b, await startPerministerSignIn(server, b));
    expect(pathOf(server, res.next)).toBe("/");
    expect(await accountsForSubject(ctx.db, who.subjectId)).toHaveLength(1);
  });
});

describe("the Perminister client secret stays on the server", () => {
  // - [ ] The Perminister client secret never reaches the browser: the authorize URL the browser is
  //       sent to carries `client_id` and never the secret.
  it("the authorize URL the browser is sent to carries client_id and no client secret", async () => {
    const server = await ctx.server();
    const b = server.browser();
    server.setPerministerAccount(account(email("secret")));
    const authorizeUrl = await startPerministerSignIn(server, b);
    const q = new URL(authorizeUrl).searchParams;
    expect(q.get("client_id")).toBeTruthy();
    expect(q.has("client_secret")).toBe(false);
    // The fake Perminister's /oauth/authorize refuses a URL that carries the secret anywhere.
    expect(() => server.approve(authorizeUrl)).not.toThrow();
  });
});

describe("Perminister's fixed callback path", () => {
  // Interfaces -> Routes: "`GET /auth/perminister/callback` | 302 to `/api/auth/callback/perminister`
  // with the same query string (Perminister's fixed callback path)"
  it("GET /auth/perminister/callback answers 302 to /api/auth/callback/perminister with the same query", async () => {
    const server = await ctx.server();
    const res = await server.browser().request("/auth/perminister/callback?code=abc&state=xyz");
    expect(res.status).toBe(302);
    expect(pathOf(server, res.next)).toBe("/api/auth/callback/perminister?code=abc&state=xyz");
  });
});
