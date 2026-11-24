import { describe, expect, it } from "vitest";
import {
  createFakePerminister,
  type FakePerminister,
} from "../testing/fake-perminister.ts";
import { perministerProvider } from "./perminister.ts";
import { s256, toPerministerAuthorizeUrl } from "./perminister-oidc.ts";

const CLIENT_SECRET = "test-perminister-secret-not-real";
const NONCE_KEY = "test-better-auth-secret-at-least-32-chars";

/** Plays Better Auth's authorize URL, finished under `key`, through the fake's approve. */
function approveFor(fake: FakePerminister, verifier: string, key: string) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: "test-client-id",
    state: "s".repeat(32),
    redirect_uri: "https://brain.test/auth/perminister/callback",
    code_challenge_method: "S256",
    code_challenge: s256(verifier),
  });
  const url = toPerministerAuthorizeUrl(
    `https://perminister.test/oauth/authorize?${q.toString()}`,
    "https://perminister.test",
    key,
  );
  const back = new URL(fake.approve(url), "https://brain.test");
  return {
    code: back.searchParams.get("code")!,
    state: back.searchParams.get("state")!,
  };
}

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(answer: () => Response): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchStub = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push({ url, init });
    return Promise.resolve(answer());
  };
  return { fetch: fetchStub, calls };
}

function provider(fetchImpl: typeof fetch) {
  return perministerProvider({
    baseUrl: "https://perminister.test",
    clientId: "test-client-id",
    clientSecret: CLIENT_SECRET,
    publicUrl: "https://brain.test",
    nonceKey: NONCE_KEY,
    fetch: fetchImpl,
  });
}

const exchange = {
  authenticated: true,
  sessionToken: "perminister-session-token",
  account: {
    subjectId: "subject-1",
    email: "Ann@Example.com",
    username: null,
    loginIdentifier: "ann@example.com",
    firstName: "Ann",
    lastName: "Lee",
  },
  session: { expiresAt: "2030-01-01T00:00:00.000Z" },
  organizations: [{ organizationId: "org-1", productId: "sky-brain" }],
};

describe("perministerProvider", () => {
  it("is the perminister generic OAuth entry with PKCE and the fixed callback", () => {
    const p = provider(stubFetch(() => new Response(null)).fetch);
    expect(p.providerId).toBe("perminister");
    expect(p.name).toBe("Perminister");
    expect(p.clientId).toBe("test-client-id");
    expect(p.authorizationUrl).toBe("https://perminister.test/oauth/authorize");
    expect(p.redirectURI).toBe("https://brain.test/auth/perminister/callback");
    expect(p.pkce).toBe(true);
  });

  it("perminister: getToken exchanges at /oauth/token, checks the ID token, reads the session", async () => {
    const fake = createFakePerminister({
      baseUrl: "https://perminister.test",
      clientId: "test-client-id",
      clientSecret: CLIENT_SECRET,
      publicUrl: "https://brain.test",
    });
    fake.setAccount({ subjectId: "subject-1", email: "ann@example.com" });
    const calls: Call[] = [];
    const spy = (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        init,
      });
      return fake.fetch(input, init);
    };
    const verifier = "v".repeat(43);
    const { code } = approveFor(fake, verifier, NONCE_KEY);
    const tokens = await provider(spy).getToken!({
      code,
      redirectURI: "https://brain.test/auth/perminister/callback",
      codeVerifier: verifier,
    });
    expect(calls.map((c) => c.url)).toEqual([
      "https://perminister.test/oauth/token",
      "https://perminister.test/.well-known/jwks.json",
      "https://perminister.test/api/auth/consumer/session",
    ]);
    const tokenCall = calls[0]!;
    expect(tokenCall.init.body as string).not.toContain(CLIENT_SECRET);
    expect(
      new URLSearchParams(tokenCall.init.body as string).get("code_verifier"),
    ).toBe(verifier);
    expect(tokens.accessToken).toMatch(/^perminister-session-subject-1-/);
    expect(tokens.accessTokenExpiresAt).toBeInstanceOf(Date);
    const profile = await provider(spy).getUserInfo!(tokens);
    expect(profile?.subjectId).toBe("subject-1");
    // From the signed ID token's email_verified claim (D29).
    expect(profile?.emailVerified).toBe(true);
  });

  it("perminister: an ID token without email_verified true gives an unverified profile", async () => {
    const fake = createFakePerminister({
      baseUrl: "https://perminister.test",
      clientId: "test-client-id",
      clientSecret: CLIENT_SECRET,
      publicUrl: "https://brain.test",
    });
    fake.setAccount({
      subjectId: "subject-2",
      email: "bob@example.com",
      emailVerified: false,
    });
    const verifier = "w".repeat(43);
    const { code } = approveFor(fake, verifier, NONCE_KEY);
    const tokens = await provider(fake.fetch).getToken!({
      code,
      redirectURI: "https://brain.test/auth/perminister/callback",
      codeVerifier: verifier,
    });
    const profile = await provider(fake.fetch).getUserInfo!(tokens);
    expect(profile?.emailVerified).toBe(false);
  });

  it("perminister: getToken refuses an ID token minted for another request's nonce", async () => {
    const fake = createFakePerminister({
      baseUrl: "https://perminister.test",
      clientId: "test-client-id",
      clientSecret: CLIENT_SECRET,
      publicUrl: "https://brain.test",
    });
    const verifier = "w".repeat(43);
    // The authorize URL was finished under another key, so its nonce is not ours.
    const { code } = approveFor(
      fake,
      verifier,
      "some-other-key-some-other-key-xx",
    );
    await expect(
      provider(fake.fetch).getToken!({
        code,
        redirectURI: "https://brain.test/auth/perminister/callback",
        codeVerifier: verifier,
      }),
    ).rejects.toThrow(/nonce/);
  });

  it("perminister: a refused exchange names only the status, never the secret", async () => {
    const refused = stubFetch(() =>
      Response.json(
        { error: "invalid_grant", echo: CLIENT_SECRET },
        { status: 400 },
      ),
    );
    const err = await provider(refused.fetch).getToken!({
      code: "bad",
      redirectURI: "https://brain.test/auth/perminister/callback",
      codeVerifier: "v",
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("400");
    expect(message).not.toContain(CLIENT_SECRET);
    expect(message).not.toContain("invalid_grant");
  });

  it("getUserInfo maps the exchange to the profile, or null without a subjectId", async () => {
    const p = provider(stubFetch(() => new Response(null)).fetch);
    const profile = await p.getUserInfo!({
      raw: { ...exchange, emailVerified: true },
    });
    expect(profile).toEqual({
      id: "subject-1",
      subjectId: "subject-1",
      email: "Ann@Example.com",
      name: "Ann Lee",
      emailVerified: true,
    });
    // Without getToken's verdict from the ID token, the email counts as unverified.
    expect((await p.getUserInfo!({ raw: exchange }))?.emailVerified).toBe(
      false,
    );
    const noName = await p.getUserInfo!({
      raw: {
        ...exchange,
        account: { subjectId: "s2", email: "b@example.com", firstName: null },
      },
    });
    expect(noName?.name).toBe("b@example.com");
    expect(await p.getUserInfo!({ raw: { account: {} } })).toBeNull();
    expect(await p.getUserInfo!({})).toBeNull();
  });
});
