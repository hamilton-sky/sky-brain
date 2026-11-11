import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  /** Postgres connection string; when unset the server uses PGlite. */
  databaseUrl: string | undefined;
  /** PGlite folder, or `memory://`. Used only when `databaseUrl` is unset. */
  pgliteDataDir: string;
  nodeEnv: string | undefined;
  /** The origin people and clients reach, e.g. `https://sky-brain.vercel.app`. */
  publicUrl: string | undefined;
  betterAuthSecret: string | undefined;
  perministerBaseUrl: string | undefined;
  perministerClientId: string | undefined;
  perministerClientSecret: string | undefined;
}

const defaultPgliteDataDir = fileURLToPath(
  new URL("../.pglite", import.meta.url),
);

export function readConfig(env: Record<string, string | undefined>): Config {
  const raw = env.PORT ?? "3000";
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port > 65535) {
    throw new Error(
      `PORT must be a whole number from 0 to 65535, got "${raw}"`,
    );
  }
  const config: Config = {
    port,
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDataDir: env.PGLITE_DATA_DIR || defaultPgliteDataDir,
    nodeEnv: env.NODE_ENV,
    publicUrl: env.PUBLIC_URL || undefined,
    betterAuthSecret: env.BETTER_AUTH_SECRET || undefined,
    perministerBaseUrl: env.PERMINISTER_BASE_URL || undefined,
    perministerClientId:
      env.PERMINISTER_APP_CLIENT_ID || env.PERMINISTER_CLIENT_ID || undefined,
    perministerClientSecret:
      env.PERMINISTER_APP_CLIENT_SECRET ||
      env.PERMINISTER_CLIENT_SECRET ||
      undefined,
  };
  if (config.nodeEnv === "production") checkProductionAuth(config);
  return config;
}

/** An `https://` origin with no path, query or trailing slash. */
function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
}

function fail(message: string): never {
  throw new Error(`${message} when NODE_ENV is production; refusing to start`);
}

/** Throws naming the first auth setting a production start is missing; never echoes a secret. */
function checkProductionAuth(config: Config): void {
  if (!config.publicUrl) fail("PUBLIC_URL must be set");
  if (!isHttpsOrigin(config.publicUrl)) {
    fail(
      "PUBLIC_URL must be an https:// origin with no path, query or trailing slash",
    );
  }
  if (!config.betterAuthSecret) fail("BETTER_AUTH_SECRET must be set");
  if (config.betterAuthSecret.length < 32) {
    fail("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  if (!config.perministerBaseUrl) fail("PERMINISTER_BASE_URL must be set");
  if (!isHttpsOrigin(config.perministerBaseUrl)) {
    fail(
      "PERMINISTER_BASE_URL must be an https:// origin with no path, query or trailing slash",
    );
  }
  if (!config.perministerClientId) {
    fail("PERMINISTER_APP_CLIENT_ID must be set");
  }
  if (!config.perministerClientSecret) {
    fail("PERMINISTER_APP_CLIENT_SECRET must be set");
  }
}

/** The dev actor header is an allow-list: on only for `NODE_ENV=development` exactly (D15). */
export function devActorHeaderEnabled(env: { NODE_ENV?: string }): boolean {
  return env.NODE_ENV === "development";
}
