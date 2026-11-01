// Render's preDeployCommand: migrates the Postgres database in DATABASE_URL.
import { closeDb, createPostgresDb, migrateDb } from "./client.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("migrate: DATABASE_URL is not set");
  process.exit(1);
}

const db = createPostgresDb(url);
try {
  await migrateDb(db);
  console.log("migrate: done");
} finally {
  await closeDb(db);
}
