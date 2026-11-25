import { sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./client.ts";
import { workspaces } from "./schema.ts";
import { closeTestDb, createTestDb } from "./test-db.ts";

describe("createTestDb", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await closeTestDb(db);
  });

  it("applies every migration in packages/db/drizzle", async () => {
    const journal = JSON.parse(
      await readFile(
        new URL("../drizzle/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    ) as { entries: unknown[] };
    const [applied] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sql`drizzle.__drizzle_migrations`);
    expect(applied!.n).toBe(journal.entries.length);
  });

  it("gives a working schema", async () => {
    const [ws] = await db
      .insert(workspaces)
      .values({ name: "test" })
      .returning({ id: workspaces.id });
    expect(ws!.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
