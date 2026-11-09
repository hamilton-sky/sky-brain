// Opens, migrates and closes the database: PGlite in tests and dev, Postgres in production.
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as schema from "./schema.ts";

/** The Drizzle Postgres database both drivers share. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A Db, or the transaction handed to `db.transaction(async (tx) => ...)`. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

interface Driver {
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const drivers = new WeakMap<Db, Driver>();

function driverOf(db: Db): Driver {
  const driver = drivers.get(db);
  if (!driver) throw new Error("This database was not opened by client.ts");
  return driver;
}

/** PGlite in a folder on disk, or in memory for `memory://` or no folder. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const client = await PGlite.create(
    dataDir && dataDir !== "memory://" ? { dataDir } : {},
  );
  const db = drizzlePglite({ client, schema });
  drivers.set(db, {
    migrate: () => migratePglite(db, { migrationsFolder }),
    close: () => client.close(),
  });
  return db;
}

export interface PostgresOptions {
  /** Most connections the pool opens. Default: node-postgres's 10. */
  max?: number;
  /** Called with the new pool, e.g. so Vercel can close idle clients. */
  onPool?: (pool: pg.Pool) => void;
}

/** Postgres through node-postgres. */
export function createPostgresDb(
  url: string,
  options: PostgresOptions = {},
): Db {
  const pool = new pg.Pool({
    connectionString: url,
    ...(options.max === undefined ? {} : { max: options.max }),
  });
  options.onPool?.(pool);
  const db = drizzleNodePg({ client: pool, schema });
  drivers.set(db, {
    migrate: () => migrateNodePg(db, { migrationsFolder }),
    close: () => pool.end(),
  });
  return db;
}

/** Applies every migration in apps/server/drizzle that has not run yet. */
export function migrateDb(db: Db): Promise<void> {
  return driverOf(db).migrate();
}

export async function closeDb(db: Db): Promise<void> {
  await driverOf(db).close();
  drivers.delete(db);
}
