// Migrates Postgres: MIGRATION_DATABASE_URL (the migrate role) when set, else DATABASE_URL.
// On Vercel it runs in the build, and only for production deploys: previews never migrate.
import { closeDb, createPostgresDb, migrateDb } from "./client.ts";

if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
  console.log(`migrate: skipped for VERCEL_ENV=${process.env.VERCEL_ENV}`);
  process.exit(0);
}

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error(
    "migrate: neither MIGRATION_DATABASE_URL nor DATABASE_URL is set",
  );
  process.exit(1);
}

const db = createPostgresDb(url);
try {
  await migrateDb(db);
  console.log("migrate: done");
} finally {
  await closeDb(db);
}
