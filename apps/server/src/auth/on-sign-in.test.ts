import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { invites, members, workspaces } from "../db/schema.ts";
import { resolveScope } from "../scope/resolve-scope.ts";
import { memberRole } from "../scope/member-role.ts";
import {
  startAuthTestServer,
  type AuthTestServer,
  type PerministerAccount,
} from "../testing/auth-harness.ts";
import {
  closeTestDb,
  createTestDb,
  seedWorkspace,
  type Db,
} from "../testing/harness.ts";
import { onSessionCreated, onSignIn } from "./on-sign-in.ts";

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

/** One whole sign-in in a fresh browser; returns the signed-in user's id. */
async function signIn(account: PerministerAccount): Promise<string> {
  server.setPerministerAccount(account);
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
  const done = await b.request(back.next!);
  expect(done.next).toMatch(/^(http:\/\/127\.0\.0\.1:\d+)?\/$/);
  const session = await b.request("/api/auth/get-session");
  return session.body.user.id as string;
}

async function membershipsOf(userId: string) {
  return db
    .select({
      workspaceId: members.workspaceId,
      role: members.role,
      name: workspaces.name,
    })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(eq(members.userId, userId));
}

async function seedInvite(email: string, role: "editor" | "viewer") {
  const ws = await seedWorkspace(db, {
    name: `Shared with ${email}`,
    members: [{ userId: "someone-else", role: "owner" }],
  });
  await db
    .insert(invites)
    .values({ workspaceId: ws.id, email, role, invitedBy: "someone-else" });
  return ws.id;
}

async function inviteOf(workspaceId: string) {
  const [row] = await db
    .select({ acceptedAt: invites.acceptedAt })
    .from(invites)
    .where(eq(invites.workspaceId, workspaceId));
  return row!;
}

describe("sign-in", () => {
  it("sign-in: a person with sky-brain access gets their own workspace as owner once", async () => {
    const account = {
      subjectId: "subject-own",
      email: "own@example.com",
      productIds: ["sky-brain"],
    };
    const first = await signIn(account);
    const second = await signIn(account);
    expect(second).toBe(first);

    const users = await db
      .select({ id: sql<string>`id` })
      .from(sql`"user"`)
      .where(sql`email = ${"own@example.com"}`);
    expect(users).toHaveLength(1);
    const accounts = await db
      .select({
        providerId: sql<string>`provider_id`,
        accountId: sql<string>`account_id`,
      })
      .from(sql`"account"`)
      .where(sql`user_id = ${first}`);
    expect(accounts).toEqual([
      { providerId: "perminister", accountId: "subject-own" },
    ]);
    const rows = await membershipsOf(first);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe("owner");
    expect(rows[0]!.name).toBe("own@example.com");
  });

  it("sign-in: two people get two walled-off workspaces", async () => {
    const ann = await signIn({
      subjectId: "subject-wa",
      email: "wa@example.com",
    });
    const bob = await signIn({
      subjectId: "subject-wb",
      email: "wb@example.com",
    });
    const [annWs] = await membershipsOf(ann);
    const [bobWs] = await membershipsOf(bob);
    expect(annWs!.workspaceId).not.toBe(bobWs!.workspaceId);
    const annActor = { kind: "human" as const, user_id: ann };
    const bobActor = { kind: "human" as const, user_id: bob };

    // Allowed: each in their own.
    expect(await memberRole(db, annWs!.workspaceId, annActor)).toBe("owner");
    expect(
      (await resolveScope(db, bobActor, { workspace_id: bobWs!.workspaceId }))
        .role,
    ).toBe("owner");
    // Refused: each in the other's (hard rule 4).
    expect(await memberRole(db, bobWs!.workspaceId, annActor)).toBeUndefined();
    expect(await memberRole(db, annWs!.workspaceId, bobActor)).toBeUndefined();
    await expect(
      resolveScope(db, annActor, { workspace_id: bobWs!.workspaceId }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      resolveScope(db, bobActor, { workspace_id: annWs!.workspaceId }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("sign-in: a person with an invite gets the invite's role", async () => {
    // Invited as `Invitee@Example.com`; Perminister gives the lower-case email.
    const shared = await seedInvite("Invitee@Example.com", "editor");
    const id = await signIn({
      subjectId: "subject-invitee",
      email: "invitee@example.com",
    });
    const rows = await membershipsOf(id);
    expect(rows).toHaveLength(2);
    const own = rows.find((r) => r.workspaceId !== shared)!;
    expect(own.role).toBe("owner");
    expect(own.name).toBe("invitee@example.com");
    expect(rows.find((r) => r.workspaceId === shared)!.role).toBe("editor");
    expect((await inviteOf(shared)).acceptedAt).toBeInstanceOf(Date);
  });

  it("sign-in: an invite to an existing account is accepted at the next sign-in", async () => {
    const account = { subjectId: "subject-later", email: "later@example.com" };
    const id = await signIn(account);
    expect(await membershipsOf(id)).toHaveLength(1);

    const shared = await seedInvite("later@example.com", "viewer");
    expect((await inviteOf(shared)).acceptedAt).toBeNull();
    await signIn(account);

    const rows = await membershipsOf(id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.role === "owner")).toHaveLength(1);
    expect(rows.find((r) => r.workspaceId === shared)!.role).toBe("viewer");
    expect((await inviteOf(shared)).acceptedAt).toBeInstanceOf(Date);
  });
});

describe("onSignIn", () => {
  it("onSignIn: keeps an existing membership and accepts the invite once", async () => {
    const ws = await seedWorkspace(db, {
      name: "Already in",
      members: [{ userId: "direct-user", role: "viewer" }],
    });
    await db.insert(invites).values({
      workspaceId: ws.id,
      email: "direct@example.com",
      role: "editor",
      invitedBy: "someone-else",
    });
    await onSignIn(db, { userId: "direct-user", email: "Direct@Example.com" });
    await onSignIn(db, { userId: "direct-user", email: "direct@example.com" });

    // The existing row wins: an invite never changes a role already held.
    expect(
      await memberRole(db, ws.id, { kind: "human", user_id: "direct-user" }),
    ).toBe("viewer");
    // A member already, so no own workspace is made.
    const rows = await db
      .select({ workspaceId: members.workspaceId })
      .from(members)
      .where(eq(members.userId, "direct-user"));
    expect(rows).toHaveLength(1);
    expect((await inviteOf(ws.id)).acceptedAt).toBeInstanceOf(Date);
  });

  it("onSignIn: a person removed from every workspace gets a new own workspace", async () => {
    await onSignIn(db, {
      userId: "removed-user",
      email: "removed@example.com",
    });
    await db.delete(members).where(eq(members.userId, "removed-user"));
    await onSignIn(db, {
      userId: "removed-user",
      email: "removed@example.com",
    });
    const rows = await db
      .select({ role: members.role })
      .from(members)
      .where(
        and(eq(members.userId, "removed-user"), eq(members.role, "owner")),
      );
    expect(rows).toHaveLength(1);
  });

  it("onSignIn: a failed sign-in grant is logged with the user id, not the email", async () => {
    await db.execute(
      sql`insert into "user" (id, name, email, email_verified) values ('failing-user', 'F', 'failing@example.com', true)`,
    );
    // The same database, except that every transaction fails.
    const broken = Object.assign(Object.create(db) as Db, {
      transaction: () => Promise.reject(new Error("database down")),
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        onSessionCreated(broken)({ userId: "failing-user" }),
      ).rejects.toThrow("database down");
      const logged = JSON.stringify(log.mock.calls);
      expect(logged).toContain("failing-user");
      expect(logged).not.toContain("failing@example.com");
    } finally {
      log.mockRestore();
    }
  });
});
