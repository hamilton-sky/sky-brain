import type { Server } from "node:http";
import { createApp } from "./app.ts";
import type { Config } from "./config.ts";
import {
  closeDb,
  createPgliteDb,
  createPostgresDb,
  migrateDb,
  type Db,
} from "./db/client.ts";

/** Postgres when DATABASE_URL is set (migrated before deploy); else PGlite, migrated here. */
async function openDb(config: Config): Promise<Db> {
  if (config.databaseUrl) return createPostgresDb(config.databaseUrl);
  if (config.nodeEnv === "production") {
    throw new Error(
      "DATABASE_URL must be set when NODE_ENV is production; refusing to start",
    );
  }
  const db = await createPgliteDb(config.pgliteDataDir);
  try {
    await migrateDb(db);
  } catch (err) {
    await closeDb(db);
    throw err;
  }
  return db;
}

export async function start(config: Config): Promise<Server> {
  const db = await openDb(config);
  let closing: Promise<void> | undefined;
  const closeOnce = () => (closing ??= closeDb(db));
  // createApp does not take the database yet: the actor ticket wires it in.
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, (err?: Error) => {
      if (err) {
        void closeOnce().finally(() => reject(err));
        return;
      }
      console.log(`sky-brain listening on port ${config.port}`);
      resolve(server);
    });
    server.on("close", () => {
      closeOnce().catch((closeErr: unknown) => {
        console.error("closing the database failed", closeErr);
      });
    });
  });
}

/** Stops the server (and so closes the database) on SIGINT or SIGTERM. */
export function closeOnSignals(server: Server): void {
  const stop = () => {
    server.close();
    server.closeAllConnections();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
