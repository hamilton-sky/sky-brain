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

// Who and where, never the password, so a failed build log says what was tried.
const target = new URL(url);
const where = `${decodeURIComponent(target.username)}@${target.hostname}:${target.port || "5432"}${target.pathname}`;
console.log(`migrate: connecting as ${where}`);

const db = createPostgresDb(url);
try {
  await migrateDb(db);
  console.log("migrate: done");
} catch (err) {
  const cause =
    err instanceof Error && err.cause instanceof Error ? err.cause : err;
  const code = (cause as { code?: unknown }).code;
  console.error(
    `migrate: FAILED as ${where}: ${cause instanceof Error ? cause.message : String(cause)}` +
      (typeof code === "string" ? ` (code ${code})` : ""),
  );
  process.exitCode = 1;
} finally {
  await closeDb(db);
}
