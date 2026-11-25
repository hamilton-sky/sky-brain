// A fake Perminister for tests (spec.md Interfaces -> How a test reaches the server): `approve`
// plays its /oauth/authorize with the checks its OIDC flow makes (scope, 43-character nonce and
// state, PKCE), and `fetch` answers /oauth/token (with an RS256 ID token), /.well-known/jwks.json
// and /api/auth/consumer/session the way its API reference says. It is handed to Better Auth as
// the Perminister `fetch`; globalThis.fetch is untouched.
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";

export interface PerministerAccount {
  subjectId: string;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** One organization per id. Default none: public registration needs no organization. */
  productIds?: string[];
  /** The ID token's `email_verified` claim. Default true. */
  emailVerified?: boolean;
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
  nonce: string;
  redirectUri: string;
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

const SCOPE = "openid profile email perminister_api";
const B64_43 = /^[A-Za-z0-9_-]{43}$/;
const KID = "fake-perminister-key";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWKS = {
  keys: [
    {
      ...keys.publicKey.export({ format: "jwk" }),
      kid: KID,
      alg: "RS256",
      use: "sig",
    },
  ],
};

function signJwt(payload: Record<string, unknown>): string {
  const enc = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${enc({ alg: "RS256", typ: "JWT", kid: KID })}.${enc(payload)}`;
  const sig = createSign("RSA-SHA256").update(body).sign(keys.privateKey);
  return `${body}.${sig.toString("base64url")}`;
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
    expect("scope", SCOPE);
    const challenge = q.get("code_challenge");
    const state = q.get("state");
    const nonce = q.get("nonce");
    // Perminister answers "Sign-in request unavailable" to anything else.
    if (!challenge || !B64_43.test(challenge)) {
      throw new Error("approve: code_challenge is not 43 base64url characters");
    }
    if (!state || !B64_43.test(state)) {
      throw new Error("approve: state is not 43 base64url characters");
    }
    if (!nonce || !B64_43.test(nonce)) {
      throw new Error("approve: nonce is not 43 base64url characters");
    }
    const code = randomBytes(24).toString("base64url");
    codes.set(code, {
      challenge,
      nonce,
      redirectUri: q.get("redirect_uri")!,
      account,
      issuedAt: Date.now(),
    });
    return `/auth/perminister/callback?${new URLSearchParams({ code, state }).toString()}`;
  }

  /** Access tokens handed out, to the account they belong to. */
  const sessions = new Map<string, PerministerAccount>();

  function sessionAnswer(a: PerministerAccount): Response {
    return Response.json({
      authenticated: true,
      account: {
        subjectId: a.subjectId,
        email: a.email,
        username: null,
        loginIdentifier: a.email ?? a.subjectId,
        firstName: a.firstName ?? null,
        lastName: a.lastName ?? null,
      },
      session: {
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      },
      organizations: (a.productIds ?? []).map((productId) => ({
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
    const basic = `Basic ${Buffer.from(
      `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
    ).toString("base64")}`;
    if (
      (init.method ?? "GET").toUpperCase() !== "POST" ||
      headers.get("authorization") !== basic ||
      !headers
        .get("content-type")
        ?.startsWith("application/x-www-form-urlencoded") ||
      typeof init.body !== "string"
    ) {
      return Response.json({ error: "invalid_client" }, { status: 401 });
    }
    const body = new URLSearchParams(init.body);
    if (body.has("client_secret")) return invalidGrant();
    const code = body.get("code");
    const verifier = body.get("code_verifier");
    if (body.get("grant_type") !== "authorization_code" || !code) {
      return invalidGrant();
    }
    const issued = codes.get(code);
    // Used up by its first exchange, good or bad.
    codes.delete(code);
    if (
      !issued ||
      Date.now() - issued.issuedAt > CODE_LIFETIME_MS ||
      !verifier ||
      s256(verifier) !== issued.challenge ||
      body.get("redirect_uri") !== issued.redirectUri
    ) {
      return invalidGrant();
    }
    const a = issued.account;
    // Tests may check that this plain value is never stored as is.
    const accessToken = `perminister-session-${a.subjectId}-${randomBytes(8).toString("hex")}`;
    sessions.set(accessToken, a);
    const now = Math.floor(Date.now() / 1000);
    return Response.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 30 * 24 * 3600,
      scope: SCOPE,
      id_token: signJwt({
        iss: baseUrl,
        sub: a.subjectId,
        aud: clientId,
        iat: now,
        exp: now + 300,
        nonce: issued.nonce,
        ...(a.email
          ? { email: a.email, email_verified: a.emailVerified ?? true }
          : {}),
      }),
    });
  }

  function sessionEndpoint(init: RequestInit): Response {
    const headers = new Headers(init.headers);
    const bearer = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const a = sessions.get(bearer);
    if (
      headers.get("x-perminister-client-id") !== clientId ||
      headers.get("x-perminister-client-secret") !== clientSecret ||
      !a
    ) {
      return Response.json({ authenticated: false }, { status: 401 });
    }
    return sessionAnswer(a);
  }

  const fakeFetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = urlOf(input);
    if (url === `${baseUrl}/oauth/token`) {
      return Promise.resolve(tokenEndpoint(init));
    }
    if (url === `${baseUrl}/.well-known/jwks.json`) {
      return Promise.resolve(Response.json(JWKS));
    }
    if (url === `${baseUrl}/api/auth/consumer/session`) {
      return Promise.resolve(sessionEndpoint(init));
    }
    return Promise.reject(new TypeError(`fake Perminister refuses ${url}`));
  };

  return {
    setAccount(a) {
      account = a;
    },
    approve,
    fetch: fakeFetch,
  };
}
