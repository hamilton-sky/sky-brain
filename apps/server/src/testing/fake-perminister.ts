// A fake Perminister for tests (spec.md Interfaces -> How a test reaches the server): `approve`
// plays its /oauth/authorize, and `fetch` answers its token exchange the way the API reference
// says. It is handed to Better Auth as the Perminister `fetch`; globalThis.fetch is untouched.
import { createHash, randomBytes, randomUUID } from "node:crypto";

export interface PerministerAccount {
  subjectId: string;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** One organization per id. Default `["sky-brain"]`. */
  productIds?: string[];
}

export interface FakePerministerOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** sky-brain's origin: the only `redirect_uri` accepted is `<publicUrl>/auth/perminister/callback`. */
  publicUrl: string;
}

export interface FakePerminister {
  setAccount(account: PerministerAccount): void;
  approve(authorizeUrl: string): string;
  fetch: typeof fetch;
}

interface IssuedCode {
  challenge: string;
  account: PerministerAccount;
  issuedAt: number;
}

const CODE_LIFETIME_MS = 5 * 60 * 1000;

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function invalidGrant(): Response {
  return Response.json({ error: "invalid_grant" }, { status: 400 });
}

export function createFakePerminister(
  options: FakePerministerOptions,
): FakePerminister {
  const { baseUrl, clientId, clientSecret, publicUrl } = options;
  let account: PerministerAccount = {
    subjectId: "subject-default",
    email: "person@example.com",
  };
  const codes = new Map<string, IssuedCode>();

  function approve(authorizeUrl: string): string {
    const prefix = `${baseUrl}/oauth/authorize?`;
    if (!authorizeUrl.startsWith(prefix)) {
      throw new Error(
        `approve: not a Perminister authorize URL: ${authorizeUrl}`,
      );
    }
    if (
      authorizeUrl.includes(clientSecret) ||
      decodeURIComponent(authorizeUrl).includes(clientSecret)
    ) {
      throw new Error("approve: the authorize URL carries the client secret");
    }
    const q = new URL(authorizeUrl).searchParams;
    const expect = (name: string, value: string) => {
      if (q.get(name) !== value) {
        throw new Error(
          `approve: ${name} is ${q.get(name) ?? "missing"}, expected ${value}`,
        );
      }
    };
    expect("client_id", clientId);
    expect("response_type", "code");
    expect("redirect_uri", `${publicUrl}/auth/perminister/callback`);
    expect("code_challenge_method", "S256");
    const challenge = q.get("code_challenge");
    const state = q.get("state");
    if (!challenge) throw new Error("approve: no code_challenge");
    if (!state) throw new Error("approve: no state");
    const code = randomBytes(24).toString("base64url");
    codes.set(code, { challenge, account, issuedAt: Date.now() });
    return `/auth/perminister/callback?${new URLSearchParams({ code, state }).toString()}`;
  }

  function answer(issued: IssuedCode): Response {
    const a = issued.account;
    return Response.json({
      authenticated: true,
      // Tests may check that this plain value is never stored as is.
      sessionToken: `perminister-session-${a.subjectId}-${randomBytes(8).toString("hex")}`,
      account: {
        subjectId: a.subjectId,
        email: a.email,
        username: null,
        loginIdentifier: a.email ?? a.subjectId,
        firstName: a.firstName ?? null,
        lastName: a.lastName ?? null,
      },
      session: {
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      },
      organizations: (a.productIds ?? ["sky-brain"]).map((productId) => ({
        organizationId: randomUUID(),
        organizationName: `Test organization for ${productId}`,
        organizationRole: "member",
        productId,
        permissions: [],
        resourceRoles: [],
        platformAdmin: false,
      })),
    });
  }

  function tokenEndpoint(init: RequestInit): Response {
    const headers = new Headers(init.headers);
    if (
      (init.method ?? "GET").toUpperCase() !== "POST" ||
      headers.get("x-perminister-client-id") !== clientId ||
      headers.get("x-perminister-client-secret") !== clientSecret ||
      !headers.get("content-type")?.startsWith("application/json")
    ) {
      return invalidGrant();
    }
    let body: unknown;
    try {
      body = JSON.parse(typeof init.body === "string" ? init.body : "");
    } catch {
      return invalidGrant();
    }
    const { grant_type, code, code_verifier } = (body ?? {}) as Record<
      string,
      unknown
    >;
    if (grant_type !== "authorization_code" || typeof code !== "string") {
      return invalidGrant();
    }
    const issued = codes.get(code);
    // Used up by its first exchange, good or bad.
    codes.delete(code);
    if (
      !issued ||
      Date.now() - issued.issuedAt > CODE_LIFETIME_MS ||
      typeof code_verifier !== "string" ||
      s256(code_verifier) !== issued.challenge
    ) {
      return invalidGrant();
    }
    return answer(issued);
  }

  const fakeFetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = urlOf(input);
    if (url !== `${baseUrl}/api/auth/consumer/token`) {
      return Promise.reject(new TypeError(`fake Perminister refuses ${url}`));
    }
    return Promise.resolve(tokenEndpoint(init));
  };

  return {
    setAccount(a) {
      account = a;
    },
    approve,
    fetch: fakeFetch,
  };
}
