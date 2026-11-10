// Test helpers for /mcp (spec.md Interfaces -> How a test reaches the server, steps 1 to 6): a
// CIMD client walks authorize -> Perminister sign-in -> consent -> token, then calls MCP with
// the access token. Tests only.
import { createHash, randomBytes } from "node:crypto";
import { expect } from "vitest";
import type {
  AuthTestServer,
  Browser,
  BrowserResponse,
  PerministerAccount,
} from "../testing/auth-harness.ts";

// Made-up client_id URLs: the fake CIMD fetch serves these documents and answers 404 for any
// other URL. claude.ai's real client id is not known offline (map.md Open questions).
export const CLAUDE_AI_CLIENT =
  "https://claude.ai.test/oauth/sky-brain-client.json";
export const CLAUDE_AI_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
export const CLAUDE_CODE_CLIENT = "https://claude-code.test/oauth/client.json";
export const SCOPE =
  "openid profile email offline_access brain:read brain:write";

export function cimdDocument(
  clientId: string,
  name: string,
  redirectUris: string[],
) {
  return {
    client_id: clientId,
    client_name: name,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

/** The fixture documents both test files serve. */
export const CIMD_DOCUMENTS = {
  [CLAUDE_AI_CLIENT]: cimdDocument(CLAUDE_AI_CLIENT, "Claude", [
    CLAUDE_AI_CALLBACK,
  ]),
  [CLAUDE_CODE_CLIENT]: cimdDocument(CLAUDE_CODE_CLIENT, "Claude Code", [
    "http://localhost/callback",
    "http://127.0.0.1/callback",
  ]),
};

/** The JWT's claims, read without checking the signature. */
export function decodeJwt(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1] ?? "";
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

/** Better Auth's `{redirect, url}` answer, or a token answer: the fields the flow reads. */
interface FlowBody {
  redirect?: unknown;
  url?: unknown;
  access_token?: unknown;
}

function bodyOf(res: BrowserResponse): FlowBody {
  return (res.body ?? {}) as FlowBody;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function queryOf(path: string): string {
  return path.slice(path.indexOf("?") + 1);
}

export interface FlowOptions {
  account: PerministerAccount;
  clientId?: string;
  redirectUri?: string;
}

/** Steps 1 to 5 for one person: returns the token response and the steps' answers. */
export async function signInAndGetToken(
  server: AuthTestServer,
  o: FlowOptions,
) {
  const clientId = o.clientId ?? CLAUDE_AI_CLIENT;
  const redirectUri = o.redirectUri ?? CLAUDE_AI_CALLBACK;
  /** A same-origin path stays a path; another origin stays a full URL. */
  const pathOf = (next: string | null): string => {
    expect(next).toBeTruthy();
    const u = new URL(next!, server.url);
    return u.origin === server.url ? u.pathname + u.search : u.href;
  };
  server.setPerministerAccount(o.account);
  const b: Browser = server.browser();
  const { verifier, challenge } = pkce();
  const state = randomBytes(8).toString("hex");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: SCOPE,
    resource: `${server.url}/mcp`,
  });
  const authorize = await b.request(`/api/auth/oauth2/authorize?${q}`);
  const toSignIn = pathOf(authorize.next);
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
  const startUrl = bodyOf(start).url as string;
  expect(startUrl.startsWith(`${server.perministerUrl}/oauth/authorize?`)).toBe(
    true,
  );
  const back = await b.request(server.approve(startUrl));
  const callback = pathOf(back.next);
  expect(callback.startsWith("/api/auth/callback/perminister?")).toBe(true);
  const done = await b.request(callback);
  // The callback answers 302 `Location: /` with a JSON body whose `url` is where the flow goes
  // on (learnings 04), so the body's `url` comes first.
  const doneBody = bodyOf(done);
  const landed = pathOf(
    doneBody.redirect === true && typeof doneBody.url === "string"
      ? doneBody.url
      : done.next,
  );

  let redirect = landed;
  if (redirect.startsWith("/consent?")) {
    const consent = await b.request(
      "/api/auth/oauth2/consent",
      json({ accept: true, oauth_query: queryOf(redirect) }),
    );
    redirect = pathOf(consent.next);
  }
  expect(redirect.startsWith(`${redirectUri}?`)).toBe(true);
  const params = new URL(redirect).searchParams;
  expect(params.get("state")).toBe(state);
  const code = params.get("code");
  expect(code).toBeTruthy();

  const token = await server.browser().request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }).toString(),
  });
  expect(token.status).toBe(200);
  const accessToken = bodyOf(token).access_token;
  expect(typeof accessToken).toBe("string");
  return {
    accessToken: accessToken as string,
    landed,
    browser: b,
  };
}

/** The parts of a JSON-RPC answer the tests read. */
export interface RpcAnswer {
  result: {
    serverInfo?: { name: string };
    isError?: boolean;
    structuredContent?: unknown;
    content?: { type: string; text: string }[];
  };
}

/** A JSON-RPC answer from an SSE body (`event: message\ndata: {...}`) or a JSON one. */
export function rpcResult(res: BrowserResponse): RpcAnswer {
  if (res.body) return res.body as RpcAnswer;
  const data = res.text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter(Boolean);
  expect(data.length).toBeGreaterThan(0);
  return JSON.parse(data[data.length - 1]!) as RpcAnswer;
}

let rpcId = 0;

/** One JSON-RPC POST to /mcp; `token` undefined sends no Authorization header. */
export function mcpPost(
  server: AuthTestServer,
  token: string | undefined,
  method: string,
  params: Record<string, unknown>,
  path = "/mcp",
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return server.browser().request(path, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
}

/** `initialize` as a 2025-era client (the spike's claude.ai shape). */
export function mcpInitialize(server: AuthTestServer, token: string) {
  return mcpPost(server, token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.0" },
  });
}

export interface WhoamiResult {
  email: string;
  user_id: string;
  workspaces: { id: string; name: string; role: string }[];
}

/** `initialize`, then `tools/call whoami`; returns its structuredContent. */
export async function callWhoami(
  server: AuthTestServer,
  token: string,
  args: Record<string, unknown> = {},
): Promise<WhoamiResult> {
  const init = await mcpInitialize(server, token);
  expect(init.status).toBe(200);
  expect(rpcResult(init).result.serverInfo?.name).toBe("sky-brain");
  const res = await mcpPost(server, token, "tools/call", {
    name: "whoami",
    arguments: args,
  });
  expect(res.status).toBe(200);
  const result = rpcResult(res).result;
  expect(result.isError ?? false).toBe(false);
  const structured = result.structuredContent as WhoamiResult;
  // One text block holding the same JSON (spec.md Interfaces -> whoami).
  const content = result.content ?? [];
  expect(content).toHaveLength(1);
  expect(content[0]!.type).toBe("text");
  expect(JSON.parse(content[0]!.text)).toEqual(structured);
  return structured;
}

/** The 401 every refused /mcp request answers with. */
export function expectChallenge(server: AuthTestServer, res: BrowserResponse) {
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toBe(
    `Bearer resource_metadata="${server.url}/.well-known/oauth-protected-resource/mcp"`,
  );
}
