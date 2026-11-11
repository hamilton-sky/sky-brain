// Story: claude.ai adds sky-brain as a connector (bar item 1: the whole claude.ai flow).
import { describe, expect, it } from "vitest";
import {
  CLAUDE_AI_CALLBACK,
  CLAUDE_CODE_CLIENT,
  INITIALIZE,
  callWhoami,
  codeGrant,
  connect,
  decodeJwt,
  email,
  getCode,
  jsonInit,
  mcpPost,
  authorizeQuery,
  pathOf,
  pkce,
  queryOf,
  account,
  perministerSignIn,
  setup,
  tokenRequest,
  usersWithEmail,
} from "./helpers.ts";

const OWNER = account(email("owner"));
const LOOPER = account(email("looper"));
const DENIER = account(email("denier"));

const ctx = setup();

describe("the 401 challenge", () => {
  // - [ ] `POST /mcp` with no token answers 401 with
  //       `WWW-Authenticate: Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource/mcp"`.
  it("POST /mcp with no token answers 401 with the resource_metadata challenge", async () => {
    const server = await ctx.server();
    const res = await mcpPost(server, INITIALIZE);
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(
      `resource_metadata="${server.url}/.well-known/oauth-protected-resource/mcp"`,
    );
  });
});

describe("discovery documents", () => {
  // - [ ] `GET /.well-known/oauth-protected-resource/mcp` (and the same path without `/mcp`) answers
  //       200 JSON with `resource` exactly `<PUBLIC_URL>/mcp` and `authorization_servers[0]` exactly
  //       `<PUBLIC_URL>/api/auth`.
  for (const path of [
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource",
  ]) {
    it(`GET ${path} answers the protected resource metadata`, async () => {
      const server = await ctx.server();
      const res = await server.browser().request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/);
      expect(res.body?.resource).toBe(`${server.url}/mcp`);
      expect(res.body?.authorization_servers?.[0]).toBe(`${server.url}/api/auth`);
    });
  }

  // - [ ] `GET /.well-known/oauth-authorization-server/api/auth` answers 200 JSON with `issuer`
  //       `<PUBLIC_URL>/api/auth`, `code_challenge_methods_supported` `["S256"]`,
  //       `token_endpoint_auth_methods_supported` containing `"none"`,
  //       `client_id_metadata_document_supported: true`, and no `registration_endpoint`.
  it("GET /.well-known/oauth-authorization-server/api/auth answers the authorization server metadata", async () => {
    const server = await ctx.server();
    const res = await server.browser().request("/.well-known/oauth-authorization-server/api/auth");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/);
    expect(res.body?.issuer).toBe(`${server.url}/api/auth`);
    expect(res.body?.code_challenge_methods_supported).toEqual(["S256"]);
    expect(res.body?.token_endpoint_auth_methods_supported).toContain("none");
    expect(res.body?.client_id_metadata_document_supported).toBe(true);
    expect(res.body).not.toHaveProperty("registration_endpoint");
  });
});

describe("a CIMD client completes the flow", () => {
  // - [ ] A client whose `client_id` is an HTTPS CIMD URL listing
  //       `https://claude.ai/api/mcp/auth_callback` completes authorize → Perminister sign-in → consent →
  //       token with PKCE S256, and gets a JWT `access_token` plus a `refresh_token`.
  it("claude.ai flow: CIMD client signs in with Perminister and whoami returns the email", async () => {
    const server = await ctx.server();
    const c = await getCode(server, OWNER);
    expect(c.redirect.startsWith(CLAUDE_AI_CALLBACK + "?")).toBe(true);
    expect(new URL(c.redirect).searchParams.get("iss")).toBe(`${server.url}/api/auth`);
    const res = await tokenRequest(server, codeGrant(c));
    expect(res.status).toBe(200);
    expect(typeof res.body?.refresh_token).toBe("string");
    expect(res.body.refresh_token.length).toBeGreaterThan(0);
    const claims = decodeJwt(res.body.access_token);
    // Happy path step 7: "JWT access token (audience `<PUBLIC_URL>/mcp`)"
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    expect(aud).toContain(`${server.url}/mcp`);
    expect(claims.iss).toBe(`${server.url}/api/auth`);
    const { whoami } = await callWhoami(server, res.body.access_token);
    expect(whoami.email).toBe(OWNER.email);
  });

  // - [ ] A Claude Code-style CIMD client listing `http://localhost/callback` and
  //       `http://127.0.0.1/callback` is accepted with a redirect on any port
  //       (`http://localhost:53682/callback`, `http://127.0.0.1:3118/callback`).
  // Edge: "Loopback redirect with a port | Accepted for `localhost` and `127.0.0.1` registered
  // without a port"
  for (const redirectUri of ["http://localhost:53682/callback", "http://127.0.0.1:3118/callback"]) {
    it(`a Claude Code-style CIMD client is accepted with the loopback redirect ${redirectUri}`, async () => {
      const server = await ctx.server();
      const c = await getCode(server, LOOPER, { clientId: CLAUDE_CODE_CLIENT, redirectUri });
      const res = await tokenRequest(server, codeGrant(c));
      expect(res.status).toBe(200);
      expect(decodeJwt(res.body.access_token)).toBeTruthy();
      expect(typeof res.body.refresh_token).toBe("string");
    });
  }

  // Edge: "Person presses Deny on consent | Redirect to the client with `error=access_denied`"
  it("pressing Deny on consent redirects to the client with error=access_denied", async () => {
    const server = await ctx.server();
    const b = server.browser();
    const auth = await b.request(
      "/api/auth/oauth2/authorize?" +
        authorizeQuery(server, { challenge: pkce().challenge, state: "deny-state" }),
    );
    const cb = await perministerSignIn(server, b, DENIER, queryOf(pathOf(server, auth.next)));
    const consentPage = pathOf(server, cb.next);
    expect(consentPage.startsWith("/consent")).toBe(true);
    const deny = await b.request(
      "/api/auth/oauth2/consent",
      jsonInit({ accept: false, oauth_query: queryOf(consentPage) }),
    );
    const to = pathOf(server, deny.next);
    expect(to.startsWith(CLAUDE_AI_CALLBACK + "?")).toBe(true);
    const params = new URL(to).searchParams;
    expect(params.get("error")).toBe("access_denied");
    expect(params.get("code")).toBeNull();
  });
});

describe("whoami", () => {
  // - [ ] `whoami` over `/mcp` with that token returns the signed-in person's email and every
  //       workspace they are a member of (their own and those they were invited to) and no other,
  //       whatever the tool arguments say.
  it("whoami returns the email, user id and own workspace as structuredContent and the same JSON as text", async () => {
    const server = await ctx.server();
    const { access_token } = await connect(server, OWNER);
    const { result, whoami } = await callWhoami(server, access_token);
    const [user] = await usersWithEmail(ctx.db, OWNER.email!);
    expect(whoami.email).toBe(OWNER.email);
    expect(whoami.user_id).toBe(user!.id);
    expect(whoami.workspaces).toHaveLength(1);
    expect(whoami.workspaces[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      role: "owner",
    });
    const texts = (result.content ?? []).filter((c: any) => c.type === "text");
    expect(texts).toHaveLength(1);
    expect(JSON.parse(texts[0].text)).toEqual(whoami);
  });

  // Edge: "`whoami` arguments name another email | Ignored; identity only from the token"
  it("whoami ignores arguments that name another person", async () => {
    const server = await ctx.server();
    const looper = await callWhoami(server, (await connect(server, LOOPER)).access_token);
    const { access_token } = await connect(server, OWNER);
    const { whoami } = await callWhoami(server, access_token, {
      email: LOOPER.email,
      user_id: looper.whoami.user_id,
      workspace_id: looper.whoami.workspaces[0]!.id,
    });
    expect(whoami.email).toBe(OWNER.email);
    expect(whoami.user_id).not.toBe(looper.whoami.user_id);
    expect(whoami.workspaces.map((w) => w.id)).not.toContain(looper.whoami.workspaces[0]!.id);
  });
});

