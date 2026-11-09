import { eq } from "drizzle-orm";
import type { Request } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startAuthTestServer,
  type AuthTestServer,
  type Browser,
} from "../testing/auth-harness.ts";
import { session } from "../db/schema.ts";
import { closeTestDb, createTestDb, type Db } from "../testing/harness.ts";
import type { Auth } from "./auth.ts";
import { sessionActorResolver } from "./session-resolver.ts";

let db: Db;
let server: AuthTestServer;

beforeAll(async () => {
  db = await createTestDb();
  server = await startAuthTestServer({ db });
});

afterAll(async () => {
  if (server) await server.close();
  if (db) await closeTestDb(db);
});

async function signedIn(subjectId: string, email: string): Promise<Browser> {
  server.setPerministerAccount({ subjectId, email });
  const b = server.browser();
  const start = await b.request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "perminister",
      callbackURL: "/",
      errorCallbackURL: "/sign-in",
    }),
  });
  const back = await b.request(server.approve(start.body.url as string));
  await b.request(back.next!);
  return b;
}

/** An Auth whose getSession answers `session` and records the headers it was given. */
function fakeAuth(session: unknown, seen: Headers[] = []): Auth {
  return {
    api: {
      getSession: ({ headers }: { headers: Headers }) => {
        seen.push(headers);
        return Promise.resolve(session);
      },
    },
  } as unknown as Auth;
}

function fakeRequest(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

describe("session", () => {
  it("session: a signed-in person reaches /api/v1 as a human", async () => {
    const b = await signedIn("subject-session", "session@example.com");
    // Allowed: the caller is known, so an unknown path is a plain 404.
    const known = await b.request("/api/v1/no-such-route");
    expect(known.status).toBe(404);
    // Refused: no cookie, no caller.
    const anonymous = await server.browser().request("/api/v1/no-such-route");
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe("unauthenticated");
  });

  it("session: the dev actor header is still refused when off", async () => {
    const b = await signedIn("subject-devheader", "devheader@example.com");
    const res = await b.request("/api/v1/no-such-route", {
      headers: {
        "x-dev-actor": JSON.stringify({ kind: "human", user_id: "someone" }),
      },
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("dev_actor_disabled");
  });

  it("session: a session ends at its first expiry, however often it is used", async () => {
    const b = await signedIn("subject-expiry", "expiry@example.com");
    const me = await b.request("/api/auth/get-session");
    const userId = me.body.user.id as string;
    const expiresAt = async () => {
      const [row] = await db
        .select({ expiresAt: session.expiresAt })
        .from(session)
        .where(eq(session.userId, userId));
      return row!.expiresAt.getTime();
    };
    // Allowed: an hour left, old enough that a rolling session would be extended, and the
    // call leaves the expiry where it was.
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    await db
      .update(session)
      .set({ expiresAt: soon })
      .where(eq(session.userId, userId));
    const allowed = await b.request("/api/v1/no-such-route");
    expect(allowed.status).toBe(404);
    expect(await expiresAt()).toBe(soon.getTime());
    // Refused: once the expiry has passed, the same cookie gets 401.
    await db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 60 * 1000) })
      .where(eq(session.userId, userId));
    const refused = await b.request("/api/v1/no-such-route");
    expect(refused.status).toBe(401);
    expect(refused.body.error.code).toBe("unauthenticated");
  });

  it("session: the resolver gives a human for a session and nothing otherwise", async () => {
    // Allowed.
    const seen: Headers[] = [];
    const resolve = sessionActorResolver(
      fakeAuth({ user: { id: "abcDEF123" }, session: {} }, seen),
    );
    expect(
      await resolve(
        fakeRequest({
          cookie: "better-auth.session_token=x",
          authorization: "Bearer not-a-session",
        }),
      ),
    ).toEqual({ kind: "human", user_id: "abcDEF123" });
    // Only the cookie reaches Better Auth, never a bearer token.
    expect(seen[0]!.get("cookie")).toBe("better-auth.session_token=x");
    expect(seen[0]!.get("authorization")).toBeNull();
    // Refused: no session, or a user id that does not fit UserIdSchema.
    expect(
      await sessionActorResolver(fakeAuth(null))(fakeRequest({})),
    ).toBeUndefined();
    expect(
      await sessionActorResolver(fakeAuth({ user: { id: "not an id!" } }))(
        fakeRequest({ cookie: "better-auth.session_token=x" }),
      ),
    ).toBeUndefined();
  });
});
