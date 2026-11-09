// The Vercel function: the whole Express app (API, MCP, auth, web fallback) on Postgres (D16).
// Bundled by `pnpm --filter @sky-brain/server build:vercel` into dist/vercel.mjs, which
// api/index.mjs at the repo root re-exports. One pool per function instance.
import { attachDatabasePool } from "@vercel/functions";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { createPostgresDb } from "./db/client.ts";

const config = readConfig(process.env);
if (!config.databaseUrl) {
  throw new Error("DATABASE_URL must be set on Vercel; refusing to start");
}

// Small pool: many instances share one PgBouncer. attachDatabasePool closes idle
// clients before Vercel suspends the instance, so no connection leaks.
const db = createPostgresDb(config.databaseUrl, {
  max: 3,
  onPool: attachDatabasePool,
});

// The dev actor header stays off: it is for NODE_ENV=development on 127.0.0.1 only (D15).
// The web build is served by Vercel's CDN; the app's own static fallback is unused here.
export default createApp({ db, devActorHeader: false });
