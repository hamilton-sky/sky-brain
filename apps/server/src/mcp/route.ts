// /mcp: MCP over streamable HTTP behind the bearer check (spec.md Design). requireMcpAuth checks
// the JWT's signature against our JWKS, its issuer, audience and expiry, reads it only from the
// Authorization header (hard rule 5), and answers anything else with 401 and the RFC 9728
// challenge. createApp mounts this before the /api 404 and the web catch-all.
import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "better-auth/node";
import type express from "express";
import type { Auth } from "../auth/auth.ts";
import type { Db } from "../db/client.ts";
import { actorFromMcpClaims } from "./actor.ts";
import { mcpServerFactory } from "./server.ts";

export interface McpRouteOptions {
  auth: Auth;
  db: Db;
  publicUrl: string;
}

export function mountMcp(app: express.Express, o: McpRouteOptions): void {
  const resource = `${o.publicUrl}/mcp`;
  // Default legacy: "stateless", so 2025-era clients are served too (spec.md Decisions).
  const mcp = createMcpHandler(mcpServerFactory(o.db));
  const unauthorized = () =>
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "invalid token" },
        id: null,
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": `Bearer resource_metadata="${o.publicUrl}/.well-known/oauth-protected-resource/mcp"`,
        },
      },
    );
  const handler = requireMcpAuth(
    o.auth,
    (request, claims) => {
      const actor = actorFromMcpClaims(claims);
      if (!actor) return unauthorized();
      const scope = typeof claims.scope === "string" ? claims.scope : "";
      // Never the raw token: tools get the actor, the client and the scopes only.
      return mcp.fetch(request, {
        authInfo: {
          token: "",
          clientId: claims.azp as string,
          scopes: scope.split(" ").filter(Boolean),
          extra: { actor },
        },
      });
    },
    { resource, issuer: `${o.publicUrl}/api/auth` },
  );
  app.all("/mcp", toNodeHandler(handler));
}
