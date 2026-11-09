// The OAuth 2.1 server half (spec.md Interfaces -> How a test reaches the server, steps 1 to 5):
// Better Auth's mcp() and cimd() drive a CIMD client from authorize to token with PKCE, through
// the fake Perminister sign-in and the consent page. These tests pin that behaviour, so a Better
// Auth upgrade that breaks claude.ai or Claude Code fails `pnpm test`.
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startAuthTestServer,
  type AuthTestServer,
  type Browser,
} from "../testing/auth-harness.ts";
import { closeTestDb, createTestDb, type Db } from "../testing/harness.ts";

// Made-up client_id URLs: the fake CIMD fetch serves these documents and answers 404 for any
// other URL. claude.ai's real client id is not known offline (map.md Open questions).
const CLAUDE_AI_CLIENT = "https://claude.ai.test/oauth/sky-brain-client.json";
const CLAUDE_AI_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CLAUDE_CODE_CLIENT = "https://claude-code.test/oauth/client.json";
const UNKNOWN_CLIENT = "https://unknown.test/oauth/client.json";
const SCOPE = "openid profile email offline_access brain:read brain:write";

function cimdDocument(clientId: string, name: string, redirectUris: string[]) {
  return {
    client_id: clientId,
    client_name: name,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

let db: Db;
let server: AuthTestServer;

beforeAll(async () => {
  db = await createTestDb();
  // Signs in with the fake Perminister's default account (productIds ["sky-brain"]).
  server = await startAuthTestServer({
    db,
    cimdDocuments: {
      [CLAUDE_AI_CLIENT]: cimdDocument(CLAUDE_AI_CLIENT, "Claude", [
        CLAUDE_AI_CALLBACK,
      ]),
      [CLAUDE_CODE_CLIENT]: cimdDocument(CLAUDE_CODE_CLIENT, "Claude Code", [
        "http://localhost/callback",
        "http://127.0.0.1/callback",
      ]),
    },
  });
});

afterAll(async () => {
  if (server) await server.close();
  if (db) await closeTestDb(db);
});

/** The JWT's claims, read without checking the signature (ticket 05 checks it). */
function decodeJwt(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** A same-origin path stays a path; another origin stays a full URL. */
function pathOf(next: string | null): string {
  expect(next).toBeTruthy();
  const u = new URL(next!, server.url);
  return u.origin === server.url ? u.pathname + u.search : u.href;
}

function queryOf(path: string): string {
  return path.slice(path.indexOf("?") + 1);
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

interface FlowOptions {
  clientId?: string;
  redirectUri?: string;
  prompt?: string;
}

function authorizePath(o: FlowOptions, challenge: string, state: string) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: o.clientId ?? CLAUDE_AI_CLIENT,
    redirect_uri: o.redirectUri ?? CLAUDE_AI_CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: SCOPE,
    resource: `${server.url}/mcp`,
  });
  if (o.prompt) q.set("prompt", o.prompt);
  return `/api/auth/oauth2/authorize?${q.toString()}`;
}

/** Steps 1 to 3: authorize, then sign in at the fake Perminister. Returns where it ended. */
async function authorizeAndSignIn(b: Browser, o: FlowOptions = {}) {
  const { verifier, challenge } = pkce();
  const state = randomBytes(8).toString("hex");
  const auth = await b.request(authorizePath(o, challenge, state));
  const toSignIn = pathOf(auth.next);
  expect(toSignIn.startsWith("/sign-in?")).toBe(true);
  const start = await b.request(
    "/api/auth/sign-in/social",
    json({
      provider: "perminister",
      callbackURL: "/",
      errorCallbackURL: "/sign-in",
      oauth_query: queryOf(toSignIn),
    }),
  );
  expect(start.status).toBe(200);
  const back = await b.request(server.approve(start.body.url as string));
  const done = await b.request(back.next!);
  // The callback answers 302 `Location: /` with a JSON body whose `url` is where the flow goes
  // on (map.md, spike quirks), so the body's `url` comes first.
  const landed =
    done.body?.redirect === true && typeof done.body.url === "string"
      ? (done.body.url as string)
      : done.next;
  return { verifier, state, landed: pathOf(landed) };
}

/** Steps 1 to 4 with Allow: the code at the client's redirect URI. */
async function getCode(o: FlowOptions = {}) {
  const b = server.browser();
  const { verifier, state, landed } = await authorizeAndSignIn(b, o);
  let redirect = landed;
  if (redirect.startsWith("/consent?")) {
    const consent = await b.request(
      "/api/auth/oauth2/consent",
      json({ accept: true, oauth_query: queryOf(redirect) }),
    );
    redirect = pathOf(consent.next);
  }
  const redirectUri = o.redirectUri ?? CLAUDE_AI_CALLBACK;
  expect(redirect.startsWith(`${redirectUri}?`)).toBe(true);
  const params = new URL(redirect).searchParams;
  expect(params.get("state")).toBe(state);
  const code = params.get("code");
  expect(code).toBeTruthy();
  return { b, code: code!, verifier, params, redirectUri };
}

/** Step 5: the token endpoint, form-urlencoded as claude.ai sends it. */
function token(fields: Record<string, string>) {
  return server.browser().request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

function codeGrant(
  c: { code: string; redirectUri: string },
  clientId: string,
  verifier?: string,
) {
  const fields: Record<string, string> = {
    grant_type: "authorization_code",
    code: c.code,
    redirect_uri: c.redirectUri,
    client_id: clientId,
  };
  if (verifier !== undefined) fields.code_verifier = verifier;
  return token(fields);
}

describe("oauth", () => {
  it("oauth: a CIMD client completes authorize to token with PKCE to the claude.ai callback", async () => {
    const c = await getCode();
    expect(c.params.get("iss")).toBe(`${server.url}/api/auth`);
    const res = await codeGrant(c, CLAUDE_AI_CLIENT, c.verifier);
    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe("string");
    expect(typeof res.body.refresh_token).toBe("string");
    const claims = decodeJwt(res.body.access_token as string);
    expect([claims.aud].flat()).toContain(`${server.url}/mcp`);
    expect(claims.iss).toBe(`${server.url}/api/auth`);
    expect(claims.azp).toBe(CLAUDE_AI_CLIENT);
  });

  it("oauth: a loopback redirect on any port is accepted", async () => {
    for (const redirectUri of [
      "http://localhost:53682/callback",
      "http://127.0.0.1:3118/callback",
    ]) {
      const c = await getCode({ clientId: CLAUDE_CODE_CLIENT, redirectUri });
      const res = await codeGrant(c, CLAUDE_CODE_CLIENT, c.verifier);
      expect(res.status).toBe(200);
      expect(typeof res.body.access_token).toBe("string");
    }
  });

  it("oauth: a redirect URI the metadata does not list is refused", async () => {
    const b = server.browser();
    const { challenge } = pkce();
    const unlisted = ["https://evil.example/cb", `${CLAUDE_AI_CALLBACK}2`];
    for (const redirectUri of unlisted) {
      const path = authorizePath({ redirectUri }, challenge, "s1");
      const res = await b.request(path);
      const next = pathOf(res.next);
      expect(next).toMatch(/^\/api\/auth\/error\?error=invalid_redirect/);
      expect(next).not.toContain("code=");
      expect(next).not.toContain("evil.example");
    }
  });

  it("oauth: a token request without the PKCE verifier is refused", async () => {
    const c = await getCode();
    const missing = await codeGrant(c, CLAUDE_AI_CLIENT);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("invalid_request");
    expect(missing.body.access_token).toBeUndefined();

    const d = await getCode();
    const wrong = await codeGrant(d, CLAUDE_AI_CLIENT, pkce().verifier);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("invalid_grant");
    expect(wrong.body.access_token).toBeUndefined();
  });

  it("oauth: a reused code answers invalid_grant", async () => {
    const c = await getCode();
    const first = await codeGrant(c, CLAUDE_AI_CLIENT, c.verifier);
    expect(first.status).toBe(200);
    const again = await codeGrant(c, CLAUDE_AI_CLIENT, c.verifier);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("invalid_grant");
    expect(again.body.access_token).toBeUndefined();
  });

  it("oauth: a refresh token rotates and a dead one answers invalid_grant", async () => {
    const c = await getCode();
    const first = await codeGrant(c, CLAUDE_AI_CLIENT, c.verifier);
    expect(first.status).toBe(200);
    const refresh = (refreshToken: string) =>
      token({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLAUDE_AI_CLIENT,
      });

    const rotated = await refresh(first.body.refresh_token as string);
    expect(rotated.status).toBe(200);
    expect(typeof rotated.body.access_token).toBe("string");
    expect(typeof rotated.body.refresh_token).toBe("string");
    expect(rotated.body.refresh_token).not.toBe(first.body.refresh_token);
    const claims = decodeJwt(rotated.body.access_token as string);
    expect([claims.aud].flat()).toContain(`${server.url}/mcp`);

    const madeUp = await refresh(randomBytes(32).toString("base64url"));
    expect(madeUp.status).toBe(400);
    expect(madeUp.body.error).toBe("invalid_grant");

    // Revoked: the rotated token, revoked by its client, no longer refreshes. (Reusing the old
    // one is not tested here: mcp() allows it for 30 seconds, refreshTokenReuseInterval.)
    const revoke = await server.browser().request("/api/auth/oauth2/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: rotated.body.refresh_token as string,
        token_type_hint: "refresh_token",
        client_id: CLAUDE_AI_CLIENT,
      }).toString(),
    });
    expect(revoke.status).toBe(200);
    const revoked = await refresh(rotated.body.refresh_token as string);
    expect(revoked.status).toBe(400);
    expect(revoked.body.error).toBe("invalid_grant");
  });

  it("oauth: an unknown CIMD client is refused", async () => {
    const path = authorizePath(
      { clientId: UNKNOWN_CLIENT },
      pkce().challenge,
      "s2",
    );
    const res = await server.browser().request(path);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_client");
    expect(res.next).toBeNull();
  });

  // followups.md, 03 item 1: sign-in.js forwards any /sign-in query as oauth_query, so a
  // crafted or altered one must be refused by Better Auth's signature check.
  it("oauth: a forged or altered oauth_query is refused", async () => {
    const forged = new URLSearchParams({
      response_type: "code",
      client_id: CLAUDE_AI_CLIENT,
      redirect_uri: "https://evil.example/cb",
      code_challenge: pkce().challenge,
      code_challenge_method: "S256",
      state: "s3",
      scope: SCOPE,
    }).toString();
    const b = server.browser();
    const start = await b.request(
      "/api/auth/sign-in/social",
      json({
        provider: "perminister",
        callbackURL: "/",
        errorCallbackURL: "/sign-in",
        oauth_query: forged,
      }),
    );
    expect(start.status).toBe(400);
    expect(start.body.error).toBe("invalid_signature");
    expect(start.text).not.toContain(server.perministerUrl);

    // A real signed consent query with its redirect_uri swapped, sent with a session.
    const { landed } = await authorizeAndSignIn(b, { prompt: "consent" });
    expect(landed.startsWith("/consent?")).toBe(true);
    const altered = new URLSearchParams(queryOf(landed));
    altered.set("redirect_uri", "https://evil.example/cb");
    const consent = await b.request(
      "/api/auth/oauth2/consent",
      json({ accept: true, oauth_query: altered.toString() }),
    );
    expect(consent.status).toBe(400);
    expect(consent.body.error).toBe("invalid_signature");
    expect(consent.text).not.toContain("evil.example");
    expect(consent.next ?? "").not.toContain("code=");
  });
});

describe("consent", () => {
  it("consent: Deny returns access_denied to the client", async () => {
    const b = server.browser();
    // prompt=consent asks again even if this person allowed this client before.
    const { state, landed } = await authorizeAndSignIn(b, {
      prompt: "consent",
    });
    expect(landed.startsWith("/consent?")).toBe(true);
    const deny = await b.request(
      "/api/auth/oauth2/consent",
      json({ accept: false, oauth_query: queryOf(landed) }),
    );
    const redirect = pathOf(deny.next);
    expect(redirect.startsWith(`${CLAUDE_AI_CALLBACK}?`)).toBe(true);
    const params = new URL(redirect).searchParams;
    expect(params.get("error")).toBe("access_denied");
    expect(params.get("state")).toBe(state);
    expect(params.get("code")).toBeNull();
  });
});

describe("pages", () => {
  it("pages: the consent page cannot be framed", async () => {
    const res = await server.browser().request("/consent");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(res.headers.get("cache-control")).toContain("no-store");
    for (const id of ["client-name", "email", "redirect-host", "scopes"]) {
      expect(res.text).toContain(`id="${id}"`);
    }
    expect(res.text).toMatch(/<button[^>]*id="allow"/);
    expect(res.text).toMatch(/<button[^>]*id="deny"/);
    expect(res.text).toContain(
      '<script src="/auth-pages/consent.js" defer></script>',
    );
    // No inline script: the only <script> is the one above.
    expect(res.text.match(/<script/g)).toHaveLength(1);

    const script = await server.browser().request("/auth-pages/consent.js");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toMatch(/^text\/javascript/);
    for (const needle of [
      "redirect_uri",
      ".host",
      "textContent",
      "/api/auth/oauth2/public-client",
      "/api/auth/get-session",
      "/api/auth/oauth2/consent",
    ]) {
      expect(script.text).toContain(needle);
    }
    expect(script.text).not.toContain("innerHTML");
  });
});
