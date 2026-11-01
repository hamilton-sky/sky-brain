// Story: A person signs in with Google — everyone who is not allowed gets "No access".
import { describe, expect, it } from "vitest";
import { seedWorkspace } from "../../../apps/server/src/testing/harness.ts";
import { invites } from "../../../apps/server/src/db/schema.ts";
import {
  email,
  expectApiError,
  getCode,
  googleSignIn,
  pathOf,
  pkce,
  authorizeQuery,
  queryOf,
  sessionCount,
  setup,
  signIn,
  usersWithEmail,
  type AuthServer,
  type GoogleUser,
  type Res,
} from "./helpers.ts";

const ALLOWED = email("allowed");
const UNVERIFIED = email("unverified");
const LATER_REMOVED = email("removed");

const ctx = setup({ allowedEmails: [ALLOWED, UNVERIFIED, LATER_REMOVED] });

function expectNoAccessLanding(server: AuthServer, res: Res): void {
  expect(pathOf(server, res.next)).toMatch(/^\/sign-in\?(.*&)?error=no_access(&|$)/);
}

/** Signs in and checks the refusal: no user, no session, a "No access" landing, no cookie. */
async function expectRefused(server: AuthServer, user: GoogleUser, existingUser = false) {
  const sessionsBefore = await sessionCount(ctx.db);
  const usersBefore = await usersWithEmail(ctx.db, user.email);
  const { browser, callback } = await signIn(server, user);
  expectNoAccessLanding(server, callback);
  expect(await sessionCount(ctx.db)).toBe(sessionsBefore);
  expect(await usersWithEmail(ctx.db, user.email)).toEqual(existingUser ? usersBefore : []);
  expectApiError(await browser.request("/api/v1/no-such-route"), 401, "unauthenticated");
  const page = await server.browser().request(pathOf(server, callback.next));
  expect(page.status).toBe(200);
  expect(page.text).toContain('id="no-access"');
  expect(page.text).toContain("No access");
}

describe("No access", () => {
  // - [ ] Signing in with any other email (including one that has only an invite, or a Google
  //       profile whose `email_verified` is not true) creates no user and no session: the browser
  //       lands on `/sign-in?error=no_access` and the page says "No access".
  // Edge: "Email not in `ALLOWED_EMAILS` and not the bootstrap owner | No user, no session;
  // `/sign-in?error=no_access` shows "No access""
  it("an email not on the list creates no user and no session and lands on /sign-in?error=no_access", async () => {
    const server = await ctx.server();
    await expectRefused(server, { email: email("stranger") });
  });

  // Edge: "Email with an invite but not on the allowlist | Same as above; the invite stays pending"
  it("an email with only an invite is refused and the invite stays pending", async () => {
    const server = await ctx.server();
    const invitee = email("inviteonly");
    const ws = await seedWorkspace(ctx.db, {
      name: "Invite only",
      members: [{ userId: "inviteOnlyOwner", role: "owner" }],
    });
    const [inv] = await ctx.db
      .insert(invites)
      .values({ workspaceId: ws.id, email: invitee, role: "editor", invitedBy: "inviteOnlyOwner" })
      .returning();
    await expectRefused(server, { email: invitee });
    const rows = await ctx.db.select().from(invites);
    expect(rows.find((r) => r.id === inv!.id)?.acceptedAt).toBeNull();
  });

  // Edge: "Google says `email_verified: false` | Same as not allowed"
  it("an allowed email whose Google profile has email_verified false is refused", async () => {
    const server = await ctx.server();
    await expectRefused(server, { email: UNVERIFIED, emailVerified: false });
  });

  // Same rule inside the OAuth flow: a refused person never reaches consent or the client.
  it("a refused person in the OAuth flow lands on /sign-in?error=no_access and gets no code", async () => {
    const server = await ctx.server();
    const b = server.browser();
    const auth = await b.request(
      "/api/auth/oauth2/authorize?" + authorizeQuery(server, { challenge: pkce().challenge }),
    );
    const toSignIn = pathOf(server, auth.next);
    expect(toSignIn.startsWith("/sign-in?")).toBe(true);
    const sessionsBefore = await sessionCount(ctx.db);
    const cb = await googleSignIn(server, b, { email: email("oauthstranger") }, queryOf(toSignIn));
    expectNoAccessLanding(server, cb);
    expect(pathOf(server, cb.next)).not.toContain("code=");
    expect(await sessionCount(ctx.db)).toBe(sessionsBefore);
  });

  // - [ ] A person taken off `ALLOWED_EMAILS` gets "No access" at their next sign-in.
  // Edge: "Allowed person taken off the list later | "No access" at the next sign-in"
  it("a person taken off ALLOWED_EMAILS gets No access at their next sign-in", async () => {
    const server = await ctx.server();
    const first = await signIn(server, { email: LATER_REMOVED });
    expect(pathOf(server, first.callback.next)).not.toMatch(/error=/);
    expect(await usersWithEmail(ctx.db, LATER_REMOVED)).toHaveLength(1);
    // The same database, now served with LATER_REMOVED off the list.
    const after = await ctx.extraServer({ allowedEmails: [ALLOWED] });
    await expectRefused(after, { email: LATER_REMOVED }, true);
  });

  it("the person still on the list keeps getting in (control for the case above)", async () => {
    const server = await ctx.server();
    const c = await getCode(server, { email: ALLOWED });
    expect(c.code).toBeTruthy();
  });
});
