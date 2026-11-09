// The one way to build the auth instance (spec.md Decisions): `start`, the Vercel function and
// the test harness all call it, so dev, tests and production cannot drift.
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { randomBytes } from "node:crypto";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { createAuth, type Auth } from "./auth.ts";

export interface AuthOverrides {
  publicUrl?: string;
  /** The `fetch` Perminister calls go through. Default: the global one. */
  perministerFetch?: typeof fetch;
  fetchClientMetadataResource?: ClientMetadataResourceFetch;
}

export interface AppAuth {
  instance: Auth;
  publicUrl: string;
}

let devSecret: string | undefined;

/** Outside production only: one random secret per process, so sessions end on restart. */
function secretOf(config: Config): string {
  if (config.betterAuthSecret) return config.betterAuthSecret;
  if (config.nodeEnv === "production") {
    throw new Error(
      "BETTER_AUTH_SECRET must be set when NODE_ENV is production; refusing to start",
    );
  }
  devSecret ??= randomBytes(32).toString("base64url");
  return devSecret;
}

export function authFromConfig(
  config: Config,
  db: Db,
  overrides: AuthOverrides = {},
): AppAuth {
  const publicUrl =
    overrides.publicUrl ??
    config.publicUrl ??
    `http://localhost:${config.port}`;
  const { perministerBaseUrl, perministerClientId, perministerClientSecret } =
    config;
  const instance = createAuth({
    db,
    publicUrl,
    secret: secretOf(config),
    ...(perministerBaseUrl && perministerClientId && perministerClientSecret
      ? {
          perminister: {
            baseUrl: perministerBaseUrl,
            clientId: perministerClientId,
            clientSecret: perministerClientSecret,
            fetch: overrides.perministerFetch ?? globalThis.fetch,
          },
        }
      : {}),
    fetchClientMetadataResource:
      overrides.fetchClientMetadataResource ?? fetchClientMetadataResource,
  });
  return { instance, publicUrl };
}
