// A fresh in-memory PGlite with every migration applied, for tests in any package.
import { closeDb, createPgliteDb, migrateDb, type Db } from "./client.ts";

/** A fresh in-memory PGlite with every migration applied. */
export async function createTestDb(): Promise<Db> {
  const db = await createPgliteDb();
  await migrateDb(db);
  return db;
}

export function closeTestDb(db: Db): Promise<void> {
  return closeDb(db);
}
