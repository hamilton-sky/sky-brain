import type { Server } from "node:http";
import { createApp } from "./app.ts";
import { authFromConfig } from "./auth/from-config.ts";
import { devActorHeaderEnabled, type Config } from "./config.ts";
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
  const devActorHeader = devActorHeaderEnabled({ NODE_ENV: config.nodeEnv });
  let app;
  try {
    app = createApp({ db, devActorHeader, auth: authFromConfig(config, db) });
  } catch (err) {
    await closeOnce();
    throw err;
  }
  return new Promise((resolve, reject) => {
    const onListen = (err?: Error) => {
      if (err) {
        void closeOnce().finally(() => reject(err));
        return;
      }
      console.log(
        devActorHeader
          ? `sky-brain listening on 127.0.0.1 port ${config.port} (dev actor header on)`
          : `sky-brain listening on port ${config.port}`,
      );
      resolve(server);
    };
    // With the dev actor header on, only this machine can reach the server (D15).
    const server = devActorHeader
      ? app.listen(config.port, "127.0.0.1", onListen)
      : app.listen(config.port, onListen);
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
