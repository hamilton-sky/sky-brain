// /mcp: MCP over streamable HTTP behind the bearer check (spec.md Design). requireMcpAuth checks
// the JWT's signature against our JWKS, its issuer, audience and expiry, reads it only from the
// Authorization header (hard rule 5), and answers anything else with 401 and the RFC 9728
// challenge. createApp mounts this before the /api 404 and the web catch-all.
import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "better-auth/node";
import type express from "express";
import type { Auth } from "../auth/auth.ts";
import type { Db } from "@sky-brain/db/client";
import type { RateLimiter } from "@sky-brain/kernel/guards/ratelimit";
import type { Push } from "../push/push.ts";
import { personOf } from "@sky-brain/kernel/actor/keys";
import { boundProfile, withProfile } from "../agents/profiles.ts";
import { actorFromMcpClaims } from "./actor.ts";
import { mcpServerFactory } from "./server.ts";

export interface McpRouteOptions {
  auth: Auth;
  db: Db;
  /** The clock board tools use. Default: `() => new Date()`. */
  now?: () => Date;
  /** The board-write limiter the REST routes share. */
  limiter?: RateLimiter;
  publicUrl: string;
  push?: Push;
}

export function mountMcp(app: express.Express, o: McpRouteOptions): void {
  const resource = `${o.publicUrl}/mcp`;
  // Default legacy: "stateless", so 2025-era clients are served too (spec.md Decisions).
  const mcp = createMcpHandler(
    mcpServerFactory(o.db, {
      ...(o.now ? { now: o.now } : {}),
      ...(o.limiter ? { limiter: o.limiter } : {}),
      publicUrl: o.publicUrl,
      ...(o.push ? { push: o.push } : {}),
    }),
  );
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
    async (request, claims) => {
      const client = actorFromMcpClaims(claims);
      if (!client) return unauthorized();
      // The role comes from the person's own binding on the server, never from the client.
      const actor = withProfile(
        client,
        await boundProfile(o.db, personOf(client), claims.azp as string),
      );
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
