// The Better Auth instance: Perminister sign-in, sky-brain as its own OAuth 2.1 authorization
// server for MCP clients (mcp + cimd + jwt), everything stored in Postgres (spec.md Design).
// The plugin list must match cli-config.ts, which generates db/auth-schema.ts from it.
import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, jwt } from "better-auth/plugins";
import type { Db } from "../db/client.ts";
import * as schema from "../db/schema.ts";
import { perministerProvider } from "./perminister.ts";

export interface CreateAuthOptions {
  db: Db;
  /** The origin people and clients reach; the issuer is `<publicUrl>/api/auth`. */
  publicUrl: string;
  secret: string;
  /** Without it there is no `perminister` provider and sign-in fails. */
  perminister?: {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    fetch: typeof fetch;
  };
  /** How CIMD documents are fetched: `@better-auth/cimd/node` in production, a fake in tests. */
  fetchClientMetadataResource: ClientMetadataResourceFetch;
}

export const MCP_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "brain:read",
  "brain:write",
];

export function createAuth(options: CreateAuthOptions) {
  const { publicUrl, perminister } = options;
  return betterAuth({
    baseURL: publicUrl,
    basePath: "/api/auth",
    secret: options.secret,
    database: drizzleAdapter(options.db, { provider: "pg", schema }),
    account: { encryptOAuthTokens: true },
    rateLimit: { storage: "database" },
    plugins: [
      jwt(),
      ...(perminister
        ? [
            genericOAuth({
              config: [perministerProvider({ ...perminister, publicUrl })],
            }),
          ]
        : []),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/consent",
        resource: `${publicUrl}/mcp`,
        scopes: MCP_SCOPES,
      }),
      cimd({
        fetchClientMetadataResource: options.fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
