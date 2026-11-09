import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startAuthTestServer,
  TEST_PERMINISTER_CLIENT_SECRET,
  type AuthTestServer,
} from "../testing/auth-harness.ts";
import { closeTestDb, createTestDb, type Db } from "../testing/harness.ts";

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

describe("discovery", () => {
  it("discovery: protected resource metadata names the /mcp resource and the issuer", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const res = await server.browser().request(path);
      expect(res.status, path).toBe(200);
      expect(res.body.resource, path).toBe(`${server.url}/mcp`);
      expect(res.body.authorization_servers[0], path).toBe(
        `${server.url}/api/auth`,
      );
    }
  });

  it("discovery: authorization server metadata advertises S256, none and CIMD", async () => {
    const res = await server
      .browser()
      .request("/.well-known/oauth-authorization-server/api/auth");
    expect(res.status).toBe(200);
    expect(res.body.issuer).toBe(`${server.url}/api/auth`);
    expect(res.body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(res.body.token_endpoint_auth_methods_supported).toContain("none");
    expect(res.body.client_id_metadata_document_supported).toBe(true);
  });

  it("discovery: dynamic client registration is off", async () => {
    const meta = await server
      .browser()
      .request("/.well-known/oauth-authorization-server/api/auth");
    expect(meta.body).not.toHaveProperty("registration_endpoint");
    const res = await server.browser().request("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Rogue",
        redirect_uris: ["https://rogue.example/cb"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(res.status >= 200 && res.status < 300).toBe(false);
  });

  it("discovery: auth routes are not shadowed by the /api 404 or the web catch-all", async () => {
    const res = await server.browser().request("/api/auth/jwks");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.keys)).toBe(true);
  });

  it("discovery: the Perminister callback forwards to Better Auth with the same query", async () => {
    const res = await server
      .browser()
      .request("/auth/perminister/callback?code=c&state=s");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/api/auth/callback/perminister?code=c&state=s",
    );
  });
});

describe("perminister", () => {
  it("perminister: sign-in sends the browser to Perminister with PKCE and no secret", async () => {
    const b = server.browser();
    const res = await b.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "perminister",
        callbackURL: "/",
        errorCallbackURL: "/sign-in",
      }),
    });
    expect(res.status).toBe(200);
    const url = res.body.url as string;
    expect(url.startsWith(`${server.perministerUrl}/oauth/authorize?`)).toBe(
      true,
    );
    expect(url).not.toContain(TEST_PERMINISTER_CLIENT_SECRET);
    expect(server.approve(url)).toMatch(
      /^\/auth\/perminister\/callback\?code=[^&]+&state=[^&]+$/,
    );
  });

  it("perminister: a callback signs the person in and keys the account by subjectId", async () => {
    server.setPerministerAccount({
      subjectId: "subject-ann",
      email: "ann@example.com",
      firstName: "Ann",
    });
    const b = server.browser();
    const start = await b.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "perminister",
        callbackURL: "/",
        errorCallbackURL: "/sign-in",
      }),
    });
    const back = await b.request(server.approve(start.body.url as string));
    expect(back.status).toBe(302);
    expect(back.next).toMatch(/^\/api\/auth\/callback\/perminister\?code=/);
    const done = await b.request(back.next!);
    expect(done.next).toMatch(/^(http:\/\/127\.0\.0\.1:\d+)?\/$/);
    expect(done.headers.getSetCookie().join("\n")).toMatch(/session_token=/);

    const session = await b.request("/api/auth/get-session");
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe("ann@example.com");

    const users = await db
      .select({ id: sql<string>`id`, email: sql<string>`email` })
      .from(sql`"user"`);
    expect(users).toHaveLength(1);
    expect(users[0]!.email).toBe("ann@example.com");
    const accounts = await db
      .select({
        userId: sql<string>`user_id`,
        providerId: sql<string>`provider_id`,
        accountId: sql<string>`account_id`,
        accessToken: sql<string | null>`access_token`,
      })
      .from(sql`"account"`);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.userId).toBe(users[0]!.id);
    expect(accounts[0]!.providerId).toBe("perminister");
    expect(accounts[0]!.accountId).toBe("subject-ann");
    expect(accounts[0]!.accessToken).toBeTruthy();
    expect(accounts[0]!.accessToken).not.toContain(
      "perminister-session-subject-ann",
    );
  });
});

async function signInWithPerminister(b: ReturnType<AuthTestServer["browser"]>) {
  const start = await b.request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "perminister",
      callbackURL: "/",
      errorCallbackURL: "/sign-in",
    }),
  });
  const back = await b.request(server.approve(start.body.url as string));
  return b.request(back.next!);
}

describe("account linking", () => {
  it("perminister: a second subject with the same email does not enter the first person's account", async () => {
    server.setPerministerAccount({
      subjectId: "subject-bea",
      email: "bea@example.com",
    });
    const first = server.browser();
    await signInWithPerminister(first);
    const bea = await first.request("/api/auth/get-session");
    expect(bea.body.user.email).toBe("bea@example.com");

    // Refused: another Perminister subject that carries the same email.
    server.setPerministerAccount({
      subjectId: "subject-impostor",
      email: "bea@example.com",
    });
    const other = server.browser();
    const done = await signInWithPerminister(other);
    expect(done.headers.getSetCookie().join("\n")).not.toMatch(
      /session_token=[^;]/,
    );
    const none = await other.request("/api/auth/get-session");
    expect(none.body?.user).toBeUndefined();
    const linked = await db
      .select({ accountId: sql<string>`account_id` })
      .from(sql`"account"`)
      .where(sql`user_id = ${bea.body.user.id}`);
    expect(linked.map((a) => a.accountId)).toEqual(["subject-bea"]);

    // Allowed: the first subject still signs in as itself.
    server.setPerministerAccount({
      subjectId: "subject-bea",
      email: "bea@example.com",
    });
    const again = server.browser();
    await signInWithPerminister(again);
    const back = await again.request("/api/auth/get-session");
    expect(back.body.user.id).toBe(bea.body.user.id);
  });
});
