// A fresh database and auth server with people signed in over the claude.ai flow. Tests only.
import { startAuthTestServer } from "../../testing/auth-harness.ts";
import { closeTestDb, createTestDb } from "../../testing/harness.ts";
import { CIMD_DOCUMENTS, tokensFor } from "./flow.ts";

/** A fresh database and auth server with `names` signed in; `close` stops both. */
export async function startWithPeople(names: string[]) {
  const db = await createTestDb();
  const server = await startAuthTestServer({
    db,
    cimdDocuments: CIMD_DOCUMENTS,
  });
  const tokens = await tokensFor(server, names);
  const close = async () => {
    await server.close();
    await closeTestDb(db);
  };
  return { db, server, tokens, close };
}
