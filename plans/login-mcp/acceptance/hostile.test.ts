// Story: Hostile callers get nothing.
import { describe, expect, it } from "vitest";
import {
  CLAUDE_AI_CLIENT,
  INITIALIZE,
  account,
  authorizeQuery,
  callWhoami,
  codeGrant,
  connect,
  email,
  getCode,
  jsonInit,
  mcpPost,
  pathOf,
  pkce,
  setup,
  tokenRequest,
  type AuthServer,
} from "./helpers.ts";

const PERSON = account(email("person"));
const EVIL = "https://evil.example/cb";

const ctx = setup();

function expectChallenge(server: AuthServer, headers: Headers): void {
  expect(headers.get("www-authenticate") ?? "").toContain(
    `resource_metadata="${server.url}/.well-known/oauth-protected-resource/mcp"`,
  );
}

/** A real access token and the user id it names. */
async function realToken(server: AuthServer) {
  const tokens = await connect(server, PERSON);
  const { whoami } = await callWhoami(server, tokens.access_token);
  return { ...tokens, sub: whoami.user_id };
}

describe("redirect URIs", () => {
  // - [ ] A redirect URI not in the client's metadata document is refused (no code is issued).
  // Edge: "Redirect URI not in the CIMD document | Authorize ends at Better Auth's error page; no code"
  it("a redirect URI not in the client's metadata document is refused with no code", async () => {
    const server = await ctx.server();
    const res = await server.browser().request(
      "/api/auth/oauth2/authorize?" +
        authorizeQuery(server, { redirectUri: EVIL, challenge: pkce().challenge }),
    );
    const to = pathOf(server, res.next);
    expect(to.startsWith("https://evil.example")).toBe(false);
    expect(to.startsWith("/sign-in")).toBe(false);
    expect(to).not.toContain("code=");
    expect(res.status >= 400 || to.includes("error")).toBe(true);
  });

  it("a redirect URI not in the metadata document is refused even for a signed-in person", async () => {
    const server = await ctx.server();
    const signedIn = await getCode(server, PERSON);
    const res = await signedIn.browser.request(
      "/api/auth/oauth2/authorize?" +
        authorizeQuery(server, { redirectUri: EVIL, challenge: pkce().challenge }),
    );
    const to = pathOf(server, res.next);
    expect(to.startsWith("https://evil.example")).toBe(false);
    expect(to).not.toContain("code=");
    expect(res.status >= 400 || to.includes("error")).toBe(true);
  });
});

describe("the token endpoint", () => {
  // - [ ] A token request without the PKCE verifier, or with a wrong one, is refused; a reused code
  //       answers `invalid_grant`; a dead refresh token answers `invalid_grant`.
  // Edge: "Missing or wrong PKCE verifier | Token endpoint refuses"
  it("a token request without the PKCE verifier is refused", async () => {
    const server = await ctx.server();
    const c = await getCode(server, PERSON);
    const res = await tokenRequest(server, codeGrant(c, null));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body?.access_token).toBeUndefined();
    expect(typeof res.body?.error).toBe("string");
  });

  it("a token request with a wrong PKCE verifier is refused", async () => {
    const server = await ctx.server();
    const c = await getCode(server, PERSON);
    const res = await tokenRequest(server, codeGrant(c, pkce().verifier));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body?.access_token).toBeUndefined();
    expect(typeof res.body?.error).toBe("string");
  });

  // Edge: "Reused authorization code | `invalid_grant`"
  it("a reused authorization code answers invalid_grant", async () => {
    const server = await ctx.server();
    const c = await getCode(server, PERSON);
    const first = await tokenRequest(server, codeGrant(c));
    expect(first.status).toBe(200);
    const again = await tokenRequest(server, codeGrant(c));
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(again.body?.error).toBe("invalid_grant");
    expect(again.body?.access_token).toBeUndefined();
  });

  // Edge: "Dead refresh token | `invalid_grant`"
  it("a dead refresh token answers invalid_grant", async () => {
    const server = await ctx.server();
    const res = await tokenRequest(server, {
      grant_type: "refresh_token",
      refresh_token: "dead" + "x".repeat(40),
      client_id: CLAUDE_AI_CLIENT,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body?.error).toBe("invalid_grant");
    expect(res.body?.access_token).toBeUndefined();
  });
});

describe("/mcp refuses bad tokens", () => {
  // - [ ] `/mcp` refuses with 401 a token with the wrong audience, the wrong issuer, an expired
  //       token, a bad signature, and the session JWT from `GET /api/auth/token`.
  // Edge: "Expired, wrong-issuer or tampered token | 401 with the challenge"
  const now = () => Math.floor(Date.now() / 1000);

  it("a token with the wrong audience answers 401", async () => {
    const server = await ctx.server();
    const { sub } = await realToken(server);
    const token = await server.signJwt({
      sub,
      azp: CLAUDE_AI_CLIENT,
      iss: `${server.url}/api/auth`,
      aud: `${server.url}/api/auth`,
      iat: now(),
      exp: now() + 600,
    });
    const res = await mcpPost(server, INITIALIZE, { token });
    expect(res.status).toBe(401);
    expectChallenge(server, res.headers);
  });

  it("a token with the wrong issuer answers 401 with the challenge", async () => {
    const server = await ctx.server();
    const { sub } = await realToken(server);
    const token = await server.signJwt({
      sub,
      azp: CLAUDE_AI_CLIENT,
      iss: "https://evil.example/api/auth",
      aud: `${server.url}/mcp`,
      iat: now(),
      exp: now() + 600,
    });
    const res = await mcpPost(server, INITIALIZE, { token });
    expect(res.status).toBe(401);
    expectChallenge(server, res.headers);
  });

  it("an expired token answers 401 with the challenge", async () => {
    const server = await ctx.server();
    const { sub } = await realToken(server);
    const token = await server.signJwt({
      sub,
      azp: CLAUDE_AI_CLIENT,
      iss: `${server.url}/api/auth`,
      aud: `${server.url}/mcp`,
      iat: now() - 7200,
      exp: now() - 3600,
    });
    const res = await mcpPost(server, INITIALIZE, { token });
    expect(res.status).toBe(401);
    expectChallenge(server, res.headers);
  });

  it("a token with a bad signature answers 401 with the challenge", async () => {
    const server = await ctx.server();
    const { access_token } = await realToken(server);
    const [h, p, sig] = access_token.split(".");
    const flipped = (sig!.startsWith("A") ? "B" : "A") + sig!.slice(1);
    const res = await mcpPost(server, INITIALIZE, { token: `${h}.${p}.${flipped}` });
    expect(res.status).toBe(401);
    expectChallenge(server, res.headers);
  });

  // Edge: "Token for another audience (session JWT from `/api/auth/token`) | 401 on `/mcp`"
  it("the session JWT from GET /api/auth/token answers 401", async () => {
    const server = await ctx.server();
    const signedIn = await getCode(server, PERSON);
    const sessionJwt = await signedIn.browser.request("/api/auth/token");
    expect(sessionJwt.status).toBe(200);
    expect(typeof sessionJwt.body?.token).toBe("string");
    const res = await mcpPost(server, INITIALIZE, { token: sessionJwt.body.token });
    expect(res.status).toBe(401);
  });

  // - [ ] A token sent as `?access_token=` in the URL is refused with 401 (CLAUDE.md hard rule 5).
  // Edge: "Token in the query string | 401"
  it("a valid token sent as ?access_token= in the URL answers 401", async () => {
    const server = await ctx.server();
    const { access_token } = await realToken(server);
    const res = await mcpPost(server, INITIALIZE, {
      path: `/mcp?access_token=${encodeURIComponent(access_token)}`,
    });
    expect(res.status).toBe(401);
    expectChallenge(server, res.headers);
  });
});

describe("dynamic client registration stays off", () => {
  // - [ ] `POST /api/auth/oauth2/register` does not exist (DCR stays off).
  it("POST /api/auth/oauth2/register does not exist", async () => {
    const server = await ctx.server();
    const res = await server.browser().request(
      "/api/auth/oauth2/register",
      jsonInit({
        client_name: "Rogue",
        redirect_uris: [EVIL],
        token_endpoint_auth_method: "none",
      }),
    );
    expect(res.status).toBe(404);
    expect(res.body?.client_id).toBeUndefined();
  });
});
