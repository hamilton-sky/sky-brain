// The bar's end-to-end test (spec.md Happy path 1 to 8): a client walks the whole connector flow
// as claude.ai does, from the 401 challenge through discovery, Perminister sign-in, consent and
// the PKCE token swap, to `whoami` on /mcp returning the signed-in person's email.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startAuthTestServer,
  type AuthTestServer,
} from "../testing/auth-harness.ts";
import { closeTestDb, createTestDb, type Db } from "../testing/harness.ts";
import {
  CIMD_DOCUMENTS,
  CLAUDE_CODE_CLIENT,
  callWhoami,
  decodeJwt,
  expectChallenge,
  mcpPost,
  signInAndGetToken,
  type FlowOptions,
} from "./test-flow.ts";

let db: Db;
let server: AuthTestServer;

beforeAll(async () => {
  db = await createTestDb();
  server = await startAuthTestServer({ db, cimdDocuments: CIMD_DOCUMENTS });
}, 60_000);

afterAll(async () => {
  if (server) await server.close();
  if (db) await closeTestDb(db);
});

/** Steps 1 to 3: the challenge and both discovery documents, read as a client reads them. */
async function discover() {
  const challenged = await mcpPost(server, undefined, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "claude-ai", version: "0.0.0" },
  });
  expectChallenge(server, challenged);
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(
    challenged.headers.get("www-authenticate")!,
  )![1]!;

  const resource = await server
    .browser()
    .request(new URL(metadataUrl).pathname);
  expect(resource.status).toBe(200);
  expect(resource.body.resource).toBe(`${server.url}/mcp`);
  expect(resource.body.authorization_servers).toEqual([
    `${server.url}/api/auth`,
  ]);

  const issuer = new URL(resource.body.authorization_servers[0] as string);
  const as = await server
    .browser()
    .request(`/.well-known/oauth-authorization-server${issuer.pathname}`);
  expect(as.status).toBe(200);
  expect(as.body.issuer).toBe(`${server.url}/api/auth`);
  expect(as.body.code_challenge_methods_supported).toContain("S256");
  expect(as.body.token_endpoint_auth_methods_supported).toContain("none");
  expect(as.body.client_id_metadata_document_supported).toBe(true);
  expect(as.body.authorization_endpoint).toBe(
    `${server.url}/api/auth/oauth2/authorize`,
  );
  expect(as.body.token_endpoint).toBe(`${server.url}/api/auth/oauth2/token`);
}

/** Steps 4 to 8 for one person and client; returns whoami's answer and the token's claims. */
async function connect(o: FlowOptions) {
  await discover();
  const { accessToken, landed } = await signInAndGetToken(server, o);
  // A first connection of this person and client asks for consent.
  expect(landed.startsWith("/consent?")).toBe(true);
  const claims = decodeJwt(accessToken);
  expect([claims.aud].flat()).toContain(`${server.url}/mcp`);
  const me = await callWhoami(server, accessToken);
  return { me, claims };
}

describe("claude.ai flow", () => {
  it("claude.ai flow: CIMD client signs in with Perminister and whoami returns the email", async () => {
    const account = {
      subjectId: "subject-claude-ai",
      email: "Shay@Example.test",
      firstName: "Shay",
    };
    const { me, claims } = await connect({ account });
    expect(me.email).toBe("shay@example.test");
    expect(me.user_id).toBe(claims.sub);
    expect(me.workspaces).toHaveLength(1);
    expect(me.workspaces[0]!.role).toBe("owner");
  });

  it("claude.ai flow: a Claude Code client on any loopback port gets whoami", async () => {
    const account = {
      subjectId: "subject-claude-code",
      email: "coder@example.test",
    };
    const { me, claims } = await connect({
      account,
      clientId: CLAUDE_CODE_CLIENT,
      redirectUri: "http://localhost:53682/callback",
    });
    expect(claims.azp).toBe(CLAUDE_CODE_CLIENT);
    expect(me.email).toBe(account.email);
    expect(me.user_id).toBe(claims.sub);
  });
});
