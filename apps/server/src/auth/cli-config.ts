// Used only by the Better Auth CLI to generate db/auth-schema.ts (see that file's header).
// It builds the same instance as the app, with every plugin on, from placeholder values: it
// never connects to a database or Perminister.
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.ts";
import { createAuth } from "./auth.ts";

export const auth = createAuth({
  db: drizzle.mock({ schema }),
  publicUrl: "http://localhost:3000",
  secret: "placeholder-secret-for-schema-generation-only",
  perminister: {
    baseUrl: "https://perminister.invalid",
    clientId: "placeholder-client-id",
    clientSecret: "placeholder-client-secret",
    fetch: () => Promise.reject(new Error("cli-config never calls out")),
  },
  fetchClientMetadataResource: () =>
    Promise.reject(new Error("cli-config never calls out")),
});
