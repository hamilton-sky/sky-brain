import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  /** Postgres connection string; when unset the server uses PGlite. */
  databaseUrl: string | undefined;
  /** PGlite folder, or `memory://`. Used only when `databaseUrl` is unset. */
  pgliteDataDir: string;
  nodeEnv: string | undefined;
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
  return {
    port,
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDataDir: env.PGLITE_DATA_DIR || defaultPgliteDataDir,
    nodeEnv: env.NODE_ENV,
  };
}
