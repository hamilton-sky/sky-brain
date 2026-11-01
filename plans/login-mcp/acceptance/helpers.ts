// Shared helpers for the login-mcp acceptance tests. They reach the server only through the
// names spec.md makes public: `startAuthTestServer` (Interfaces -> How a test reaches the
// server), brain-core's `createTestDb` and seeds, the schema's `members`, `invites` and
// `workspaces`, Better Auth's `user` and `session` tables (Migration and compatibility), and the
// routes in Interfaces -> Routes this feature adds.
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, vi } from "vitest";
import {
  closeTestDb,
  createTestDb,
} from "../../../apps/server/src/testing/harness.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

export type Db = Awaited<ReturnType<typeof createTestDb>>;

// The auth harness does not exist until the feature is built, so it is loaded lazily: each test
// fails on its own when it is missing, instead of the whole file failing to load.
const AUTH_HARNESS = new URL(
  "../../../apps/server/src/testing/auth-harness.ts",
  import.meta.url,
).href;

export interface ServerOpts {
  bootstrapOwnerEmail?: string;
  allowedEmails?: string[];
  cimdDocuments?: Record<string, object>;
}

export interface Res {
  status: number;
  headers: Headers;
  body: any;
  text: string;
  next: string | null;
}

export interface Browser {
  request(path: string, init?: RequestInit): Promise<Res>;
}

export interface AuthServer {
  url: string;
  setGoogleUser(p: {
    email: string;
    sub?: string;
    emailVerified?: boolean;
    name?: string;
  }): void;
  browser(): Browser;
  signJwt(payload: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export async function startAuthServer(
  db: Db,
  opts: ServerOpts = {},
): Promise<AuthServer> {
  const mod: any = await import(/* @vite-ignore */ AUTH_HARNESS);
  return (await mod.startAuthTestServer({
    db,
    cimdDocuments: defaultCimdDocuments(),
    ...opts,
  })) as AuthServer;
}

export interface Ctx {
  db: Db;
  /** The file's auth server, started on first use. */
  server(): Promise<AuthServer>;
  /** Another auth server on the same database (closed after the file). */
  extraServer(opts: ServerOpts): Promise<AuthServer>;
}

/** One PGlite database per file; the auth server starts lazily with `opts`. */
export function setup(opts: ServerOpts = {}): Ctx {
  let started: Promise<AuthServer> | undefined;
  const extras: AuthServer[] = [];
  const ctx: Ctx = {
    db: undefined as unknown as Db,
    server() {
      started ??= startAuthServer(ctx.db, opts);
      return started;
    },
    async extraServer(o) {
      const s = await startAuthServer(ctx.db, o);
      extras.push(s);
      return s;
    },
  };
  beforeAll(async () => {
    ctx.db = await createTestDb();
  });
  afterAll(async () => {
    for (const s of extras) await s.close();
    if (started) {
      const s = await started.catch(() => undefined);
      if (s) await s.close();
    }
    if (ctx.db) await closeTestDb(ctx.db);
  });
  return ctx;
}

let counter = 0;
const run = Math.random().toString(36).slice(2, 8);
/** A unique lower-case email at example.com. */
export function email(prefix: string): string {
  counter += 1;
  return `${prefix}-${run}-${counter}@example.com`;
}

// ---- CIMD fixtures -------------------------------------------------------------------------

export const CLAUDE_AI_CLIENT = "https://claude.ai/oauth/mcp-oauth-client-metadata";
export const CLAUDE_AI_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
export const CLAUDE_CODE_CLIENT =
  "https://claude.ai/oauth/claude-code-client-metadata";

export function defaultCimdDocuments(): Record<string, object> {
  const doc = (client_id: string, client_name: string, redirect_uris: string[]) => ({
    client_id,
    client_name,
    redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  return {
    [CLAUDE_AI_CLIENT]: doc(CLAUDE_AI_CLIENT, "Claude", [CLAUDE_AI_CALLBACK]),
    [CLAUDE_CODE_CLIENT]: doc(CLAUDE_CODE_CLIENT, "Claude Code", [
      "http://localhost/callback",
      "http://127.0.0.1/callback",
    ]),
  };
}

// ---- small HTTP helpers --------------------------------------------------------------------

/** `next` as a path when it points at the server itself. */
export function pathOf(server: AuthServer, next: string | null): string {
  if (!next) return "";
  return next.startsWith(server.url) ? next.slice(server.url.length) || "/" : next;
}

export function queryOf(next: string): string {
  const i = next.indexOf("?");
  return i === -1 ? "" : next.slice(i + 1);
}

export function jsonInit(body: unknown, method = "POST"): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function formInit(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  };
}

export function expectApiError(res: Res, status: number, code: string): void {
  expect({ status: res.status, code: res.body?.error?.code }).toEqual({
    status,
    code,
  });
}

// ---- Google sign-in ------------------------------------------------------------------------

export interface GoogleUser {
  email: string;
  sub?: string;
  emailVerified?: boolean;
  name?: string;
}

function googleUser(u: GoogleUser): Required<GoogleUser> {
  return {
    sub: "g" + createHash("sha256").update(u.email.toLowerCase()).digest("hex").slice(0, 20),
    emailVerified: true,
    name: u.email.split("@")[0]!,
    ...u,
  } as Required<GoogleUser>;
}

/**
 * Steps 2 and 3 of the flow in Interfaces: `sign-in/social` then the Google callback. Returns
 * the callback's response; its `next` is where the browser lands.
 */
export async function googleSignIn(
  server: AuthServer,
  b: Browser,
  user: GoogleUser,
  oauthQuery?: string,
): Promise<Res> {
  server.setGoogleUser(googleUser(user));
  const start = await b.request(
    "/api/auth/sign-in/social",
    jsonInit({
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/sign-in",
      ...(oauthQuery !== undefined ? { oauth_query: oauthQuery } : {}),
    }),
  );
  const googleUrl: string = start.body?.url ?? start.next ?? "";
  expect(googleUrl).toMatch(/^https:\/\/accounts\.google\.com\//);
  const state = new URL(googleUrl).searchParams.get("state");
  expect(state).toBeTruthy();
  return b.request(
    `/api/auth/callback/google?code=x&state=${encodeURIComponent(state!)}`,
  );
}

/** A plain sign-in (no OAuth client), as a person opening the site would. */
export async function signIn(
  server: AuthServer,
  user: GoogleUser,
): Promise<{ browser: Browser; callback: Res }> {
  const browser = server.browser();
  const callback = await googleSignIn(server, browser, user);
  return { browser, callback };
}

// ---- OAuth 2.1 + PKCE ----------------------------------------------------------------------

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export interface AuthorizeParams {
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  state?: string;
  challenge: string;
}

export function authorizeQuery(server: AuthServer, p: AuthorizeParams): string {
  return new URLSearchParams({
    response_type: "code",
    client_id: p.clientId ?? CLAUDE_AI_CLIENT,
    redirect_uri: p.redirectUri ?? CLAUDE_AI_CALLBACK,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    state: p.state ?? randomBytes(8).toString("hex"),
    scope: p.scope ?? "openid profile email offline_access",
    resource: `${server.url}/mcp`,
  }).toString();
}

export interface CodeResult {
  code: string;
  state: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  browser: Browser;
  /** Where consent sent the browser. */
  redirect: string;
}

/**
 * Steps 1 to 4 of the flow: authorize, Google sign-in, consent (Allow). Fails the test when a
 * step does not lead where Interfaces says.
 */
export async function getCode(
  server: AuthServer,
  user: GoogleUser,
  opts: { clientId?: string; redirectUri?: string; browser?: Browser } = {},
): Promise<CodeResult> {
  const b = opts.browser ?? server.browser();
  const { verifier, challenge } = pkce();
  const state = randomBytes(8).toString("hex");
  const clientId = opts.clientId ?? CLAUDE_AI_CLIENT;
  const redirectUri = opts.redirectUri ?? CLAUDE_AI_CALLBACK;
  const auth = await b.request(
    "/api/auth/oauth2/authorize?" +
      authorizeQuery(server, { clientId, redirectUri, challenge, state }),
  );
  const toSignIn = pathOf(server, auth.next);
  expect(toSignIn.startsWith("/sign-in?")).toBe(true);
  const cb = await googleSignIn(server, b, user, queryOf(toSignIn));
  let redirect = pathOf(server, cb.next);
  if (redirect.startsWith("/consent")) {
    const consent = await b.request(
      "/api/auth/oauth2/consent",
      jsonInit({ accept: true, oauth_query: queryOf(redirect) }),
    );
    redirect = pathOf(server, consent.next);
  }
  expect(redirect.startsWith(redirectUri + "?")).toBe(true);
  const params = new URL(redirect).searchParams;
  expect(params.get("state")).toBe(state);
  const code = params.get("code");
  expect(code).toBeTruthy();
  return { code: code!, state, verifier, redirectUri, clientId, browser: b, redirect };
}

/** Step 5: swap a code at the token endpoint. */
export function tokenRequest(
  server: AuthServer,
  fields: Record<string, string>,
): Promise<Res> {
  return server.browser().request("/api/auth/oauth2/token", formInit(fields));
}

export function codeGrant(c: CodeResult, verifier: string | null = c.verifier) {
  return {
    grant_type: "authorization_code",
    code: c.code,
    redirect_uri: c.redirectUri,
    client_id: c.clientId,
    ...(verifier !== null ? { code_verifier: verifier } : {}),
  };
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
}

/** The whole flow: an access token for `user` through the claude.ai CIMD client. */
export async function connect(
  server: AuthServer,
  user: GoogleUser,
  opts: { clientId?: string; redirectUri?: string } = {},
): Promise<Tokens> {
  const c = await getCode(server, user, opts);
  const res = await tokenRequest(server, codeGrant(c));
  expect(res.status).toBe(200);
  expect(typeof res.body?.access_token).toBe("string");
  return res.body as Tokens;
}

export function decodeJwt(token: string): Record<string, any> {
  const parts = token.split(".");
  expect(parts).toHaveLength(3);
  return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
}

// ---- MCP -----------------------------------------------------------------------------------

export interface McpCall {
  status: number;
  headers: Headers;
  /** The JSON-RPC message answering the request, or null. */
  message: any;
  text: string;
}

function parseRpc(text: string, contentType: string, id: number): any {
  const candidates: any[] = [];
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        candidates.push(JSON.parse(line.slice(5).trim()));
      } catch {
        // not a JSON data line
      }
    }
  } else {
    try {
      const v = JSON.parse(text);
      candidates.push(...(Array.isArray(v) ? v : [v]));
    } catch {
      // not JSON
    }
  }
  return candidates.find((m) => m && m.id === id) ?? candidates[0] ?? null;
}

/** POST one JSON-RPC message to `/mcp`. */
export async function mcpPost(
  server: AuthServer,
  message: Record<string, unknown>,
  opts: { token?: string; headers?: Record<string, string>; path?: string } = {},
): Promise<McpCall> {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    ...opts.headers,
  };
  const res = await fetch(server.url + (opts.path ?? "/mcp"), {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    text,
    message: parseRpc(text, res.headers.get("content-type") ?? "", message.id as number),
  };
}

export const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "login-mcp-acceptance", version: "0.0.0" },
  },
};

export interface Whoami {
  email: string;
  user_id: string;
  workspaces: { id: string; name: string; role: string }[];
}

/** Step 6: `initialize` then `tools/call whoami`; returns the tool result. */
export async function callWhoami(
  server: AuthServer,
  token: string,
  args: Record<string, unknown> = {},
): Promise<{ result: any; whoami: Whoami }> {
  const init = await mcpPost(server, INITIALIZE, { token });
  expect(init.status).toBe(200);
  expect(init.message?.result).toBeTruthy();
  const headers: Record<string, string> = {
    "mcp-protocol-version":
      init.message.result.protocolVersion ?? INITIALIZE.params.protocolVersion,
  };
  const sessionId = init.headers.get("mcp-session-id");
  if (sessionId) headers["mcp-session-id"] = sessionId;
  await mcpPost(
    server,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { token, headers },
  );
  const call = await mcpPost(
    server,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "whoami", arguments: args },
    },
    { token, headers },
  );
  expect(call.status).toBe(200);
  const result = call.message?.result;
  expect(result).toBeTruthy();
  expect(result.isError ?? false).toBe(false);
  return { result, whoami: result.structuredContent as Whoami };
}

// ---- database ------------------------------------------------------------------------------

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Better Auth's `user` rows for an email (any case). */
export async function usersWithEmail(
  db: Db,
  address: string,
): Promise<{ id: string; email: string }[]> {
  const res: any = await db.execute(
    `select id, email from "user" where lower(email) = lower(${sqlString(address)})`,
  );
  return res.rows;
}

export async function sessionCount(db: Db): Promise<number> {
  const res: any = await db.execute(`select count(*)::int as n from "session"`);
  return Number(res.rows[0].n);
}

export async function userCount(db: Db): Promise<number> {
  const res: any = await db.execute(`select count(*)::int as n from "user"`);
  return Number(res.rows[0].n);
}
