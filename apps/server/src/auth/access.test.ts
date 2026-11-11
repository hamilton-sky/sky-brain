import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invites } from "../db/schema.ts";
import {
  startAuthTestServer,
  type AuthTestServer,
  type Browser,
  type PerministerAccount,
} from "../testing/auth-harness.ts";
import {
  closeTestDb,
  createTestDb,
  seedWorkspace,
  type Db,
} from "../testing/harness.ts";
import { mayEnter, PERMINISTER_PRODUCT_ID } from "./access.ts";

let db: Db;
let server: AuthTestServer;

beforeAll(async () => {
  db = await createTestDb();
  server = await startAuthTestServer({ db });
});

afterAll(async () => {
  if (server) await server.close();
  if (db) await closeTestDb(db);
});

/** The error URL Better Auth sends the browser to, with or without the origin. */
function errorUrl(code: string): RegExp {
  return new RegExp(`^(http://127\\.0\\.0\\.1:\\d+)?/sign-in\\?error=${code}`);
}

async function startSignIn(b: Browser): Promise<string> {
  const start = await b.request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "perminister",
      callbackURL: "/",
      errorCallbackURL: "/sign-in",
    }),
  });
  expect(start.status).toBe(200);
  return start.body.url as string;
}

/** One whole sign-in in a fresh browser; `callback` is the path `approve` returned. */
async function signIn(account: PerministerAccount) {
  server.setPerministerAccount(account);
  const b = server.browser();
  const callback = server.approve(await startSignIn(b));
  const back = await b.request(callback);
  const done = await b.request(back.next!);
  return { b, done, callback };
}

function setsSession(res: { headers: Headers }): boolean {
  return /session_token=[^;]/.test(res.headers.getSetCookie().join("\n"));
}

async function userCount(email: string): Promise<number> {
  const rows = await db
    .select({ id: sql<string>`id` })
    .from(sql`"user"`)
    .where(sql`email = ${email}`);
  return rows.length;
}

describe("access", () => {
  it("access: mayEnter allows a Perminister account with sky-brain access", () => {
    expect(PERMINISTER_PRODUCT_ID).toBe("sky-brain");
    // Allowed.
    expect(
      mayEnter({ email: "ann@example.com", productIds: ["sky-brain"] }),
    ).toBe(true);
    expect(
      mayEnter({
        email: "ann@example.com",
        productIds: ["other", "sky-brain"],
      }),
    ).toBe(true);
    // Refused: no email.
    expect(mayEnter({ email: null, productIds: ["sky-brain"] })).toBe(false);
    expect(mayEnter({ email: undefined, productIds: ["sky-brain"] })).toBe(
      false,
    );
    expect(mayEnter({ email: "", productIds: ["sky-brain"] })).toBe(false);
    // Refused: organizations for another product only, or none.
    expect(mayEnter({ email: "ann@example.com", productIds: ["other"] })).toBe(
      false,
    );
    expect(mayEnter({ email: "ann@example.com", productIds: [] })).toBe(false);
  });
});

describe("sign-in refused", () => {
  it("sign-in: an account without sky-brain access gets no access", async () => {
    const { b, done } = await signIn({
      subjectId: "subject-noaccess",
      email: "noaccess@example.com",
      productIds: ["another-product"],
    });
    expect(done.next).toMatch(errorUrl("no_access"));
    expect(setsSession(done)).toBe(false);
    const session = await b.request("/api/auth/get-session");
    expect(session.body?.user).toBeUndefined();
    expect(await userCount("noaccess@example.com")).toBe(0);

    const page = await b.request("/sign-in?error=no_access");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toMatch(/^text\/html/);
    expect(page.text).toContain('id="no-access"');
    expect(page.text).toContain("No access");
    const script = await b.request("/auth-pages/sign-in.js");
    expect(script.status).toBe(200);
    expect(script.text).toContain("no-access");
    expect(script.text).toContain("error");
  });

  it("sign-in: an invited account without sky-brain access gets no access", async () => {
    const ws = await seedWorkspace(db, { name: "Invited elsewhere" });
    await db.insert(invites).values({
      workspaceId: ws.id,
      email: "invited-noaccess@example.com",
      role: "editor",
      invitedBy: "owner-user",
    });
    const { done } = await signIn({
      subjectId: "subject-invited-noaccess",
      email: "invited-noaccess@example.com",
      productIds: [],
    });
    expect(done.next).toMatch(errorUrl("no_access"));
    expect(setsSession(done)).toBe(false);
    expect(await userCount("invited-noaccess@example.com")).toBe(0);
    const [invite] = await db
      .select({ acceptedAt: invites.acceptedAt })
      .from(invites)
      .where(sql`${invites.workspaceId} = ${ws.id}`);
    expect(invite!.acceptedAt).toBeNull();
  });

  it("sign-in: an account without an email gets no access", async () => {
    const { b, done } = await signIn({
      subjectId: "subject-noemail",
      email: null,
    });
    expect(done.next).toMatch(errorUrl("email_not_found"));
    expect(setsSession(done)).toBe(false);
    const session = await b.request("/api/auth/get-session");
    expect(session.body?.user).toBeUndefined();
    const accounts = await db
      .select({ id: sql<string>`id` })
      .from(sql`"account"`)
      .where(sql`account_id = ${"subject-noemail"}`);
    expect(accounts).toHaveLength(0);
  });

  it("sign-in: a person whose access was taken away gets no access at the next sign-in", async () => {
    // Allowed while Perminister lists sky-brain.
    const first = await signIn({
      subjectId: "subject-revoked",
      email: "revoked@example.com",
      productIds: ["sky-brain"],
    });
    expect(setsSession(first.done)).toBe(true);
    // Refused once it does not.
    const second = await signIn({
      subjectId: "subject-revoked",
      email: "revoked@example.com",
      productIds: [],
    });
    expect(second.done.next).toMatch(errorUrl("no_access"));
    expect(setsSession(second.done)).toBe(false);
    const session = await second.b.request("/api/auth/get-session");
    expect(session.body?.user).toBeUndefined();
  });

  it("sign-in: a forged state or a refused code creates no session", async () => {
    // A made-up state.
    server.setPerministerAccount({
      subjectId: "subject-forged",
      email: "forged@example.com",
    });
    const forger = server.browser();
    const real = server.approve(await startSignIn(forger));
    const code = new URL(real, server.url).searchParams.get("code")!;
    const forged = await forger.request(
      `/auth/perminister/callback?code=${encodeURIComponent(code)}&state=made-up-state`,
    );
    const forgedEnd = await forger.request(forged.next!);
    expect(forgedEnd.next).toMatch(/[?&]error=state_mismatch/);
    expect(setsSession(forgedEnd)).toBe(false);
    expect(await userCount("forged@example.com")).toBe(0);

    // No state at all: the same error, not Better Auth's `state_not_found`.
    for (const query of ["", "&state="]) {
      const stateless = await forger.request(
        `/auth/perminister/callback?code=${encodeURIComponent(code)}${query}`,
      );
      const statelessEnd = await forger.request(stateless.next!);
      expect(statelessEnd.next).toMatch(/[?&]error=state_mismatch/);
      expect(setsSession(statelessEnd)).toBe(false);
    }
    expect(await userCount("forged@example.com")).toBe(0);

    // A code that was already exchanged, sent with the state of a fresh sign-in.
    const used = await signIn({
      subjectId: "subject-reused",
      email: "reused@example.com",
    });
    expect(setsSession(used.done)).toBe(true);
    const usedCode = new URL(used.callback, server.url).searchParams.get(
      "code",
    )!;
    const replay = server.browser();
    const state = new URL(await startSignIn(replay)).searchParams.get("state")!;
    const back = await replay.request(
      `/auth/perminister/callback?${new URLSearchParams({ code: usedCode, state }).toString()}`,
    );
    const end = await replay.request(back.next!);
    expect(end.next).toMatch(errorUrl("invalid_code"));
    expect(setsSession(end)).toBe(false);
    const session = await replay.request("/api/auth/get-session");
    expect(session.body?.user).toBeUndefined();
  });
});

describe("pages", () => {
  it("pages: the sign-in page cannot be framed", async () => {
    const res = await server.browser().request("/sign-in");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(res.text).toMatch(
      /<button[^>]*id="perminister"[^>]*>Sign in with Perminister<\/button>/,
    );
    expect(res.text).toMatch(/<section[^>]*id="no-access"[^>]*hidden/);
    expect(res.text).toContain("Try another account");
    expect(res.text).toContain(
      '<script src="/auth-pages/sign-in.js" defer></script>',
    );
    // No inline script: the only <script> is the one above.
    expect(res.text.match(/<script/g)).toHaveLength(1);
    const script = await server.browser().request("/auth-pages/sign-in.js");
    expect(script.text).toContain("/api/auth/sign-in/social");
    expect(script.text).toContain("textContent");
    expect(script.text).not.toContain("innerHTML");
  });
});
