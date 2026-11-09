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
import { mayEnter, productIdsOf } from "./access.ts";
import { onSessionCreated } from "./on-sign-in.ts";
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
    // No linking by email: an account is keyed by (provider, subjectId) only, so a second
    // Perminister subject with the same email cannot enter an existing person's user.
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    rateLimit: { storage: "database" },
    // Sessions end at their first expiry (7 days): no rolling refresh, so a person whose
    // sky-brain access was taken away in Perminister cannot keep a session alive by using it.
    session: { disableSessionRefresh: true },
    // Runs before the user is created and on every later sign-in with the fresh Perminister
    // profile, so access taken away in Perminister refuses the next sign-in (spec.md Decisions).
    user: {
      validateUserInfo: ({ user, source }) =>
        mayEnter({
          email: user.email,
          productIds: productIdsOf(source.oauth?.profile),
        })
          ? undefined
          : { error: "no_access" },
    },
    // Every sign-in: an own workspace when the person has none, then pending invites.
    databaseHooks: {
      session: { create: { after: onSessionCreated(options.db) } },
    },
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
