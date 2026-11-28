// The Better Auth instance: Perminister sign-in, sky-brain as its own OAuth 2.1 authorization
// server for MCP clients (mcp + cimd + jwt), everything stored in Postgres (spec.md Design).
// The plugin list must match cli-config.ts, which generates db/auth-schema.ts from it.
import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { genericOAuth, jwt } from "better-auth/plugins";
import type { Db } from "@sky-brain/db/client";
import * as schema from "@sky-brain/db/schema";
import { mayEnter } from "./access.ts";
import { onSessionCreated } from "./on-sign-in.ts";
import { perministerProvider } from "./perminister.ts";
import { toPerministerAuthorizeUrl } from "./perminister-oidc.ts";

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

const MCP_SCOPES = [
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
      validateUserInfo: ({ user }) =>
        mayEnter({ email: user.email, emailVerified: user.emailVerified })
          ? undefined
          : { error: "no_access" },
    },
    // Every sign-in: an own workspace when the person has none, then pending invites.
    // Perminister's OIDC authorize request needs a scope, a nonce and a 43-character state that
    // Better Auth does not make itself (perminister-oidc.ts).
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (!perminister || ctx.path !== "/sign-in/social") return;
        const returned: unknown = ctx.context.returned;
        if (
          typeof returned !== "object" ||
          returned === null ||
          typeof (returned as { url?: unknown }).url !== "string"
        ) {
          return;
        }
        const answer = returned as { url: string; redirect?: boolean };
        return ctx.json({
          ...answer,
          url: toPerministerAuthorizeUrl(
            answer.url,
            perminister.baseUrl,
            options.secret,
          ),
        });
      }),
    },
    databaseHooks: {
      session: { create: { after: onSessionCreated(options.db) } },
    },
    plugins: [
      jwt(),
      ...(perminister
        ? [
            genericOAuth({
              config: [
                perministerProvider({
                  ...perminister,
                  publicUrl,
                  nonceKey: options.secret,
                }),
              ],
            }),
          ]
        : []),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/consent",
        resource: `${publicUrl}/mcp`,
        scopes: MCP_SCOPES,
        // Normal product flow (D49): MCP clients may register themselves before the person
        // signs in, so end users are never asked for a client_id. Registration only creates
        // the client record; tokens still need Perminister sign-in, sky-brain access and
        // consent, and public clients still need PKCE.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultScopes: MCP_SCOPES,
        clientRegistrationDefaultApplicationType: "infer",
      }),
      cimd({
        fetchClientMetadataResource: options.fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
