// The one way to build the auth instance (spec.md Decisions): `start`, the Vercel function and
// the test harness all call it, so dev, tests and production cannot drift.
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

/** The file beside a persistent dev PGlite database that keeps its secret. */
const DEV_SECRET_FILE = "sky-brain-auth-secret";

/**
 * Outside production, a secret that lasts as long as the dev database: the jwt() keys and the
 * Perminister tokens are encrypted with it, so a new one would break them on restart. A
 * persistent PGlite keeps it in a file in its own folder; memory or Postgres get one per process.
 */
function secretOf(config: Config): string {
  if (config.betterAuthSecret) return config.betterAuthSecret;
  if (config.nodeEnv === "production") {
    throw new Error(
      "BETTER_AUTH_SECRET must be set when NODE_ENV is production; refusing to start",
    );
  }
  if (!config.databaseUrl && config.pgliteDataDir !== "memory://") {
    return persistentDevSecret(config.pgliteDataDir);
  }
  devSecret ??= randomBytes(32).toString("base64url");
  return devSecret;
}

function persistentDevSecret(dataDir: string): string {
  const file = join(dataDir, DEV_SECRET_FILE);
  mkdirSync(dataDir, { recursive: true });
  try {
    writeFileSync(file, randomBytes(32).toString("base64url"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const secret = readFileSync(file, "utf8").trim();
  if (secret.length < 32) {
    throw new Error(
      `${file} holds a dev BETTER_AUTH_SECRET under 32 characters; delete it or set BETTER_AUTH_SECRET`,
    );
  }
  return secret;
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
