import { describe, expect, it } from "vitest";
import { perministerProvider } from "./perminister.ts";

const CLIENT_SECRET = "test-perminister-secret-not-real";

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

  it("perminister: getToken sends the client headers and names only the status on failure", async () => {
    const ok = stubFetch(() => Response.json(exchange));
    const tokens = await provider(ok.fetch).getToken!({
      code: "the-code",
      redirectURI: "https://brain.test/auth/perminister/callback",
      codeVerifier: "the-verifier",
    });
    expect(ok.calls).toHaveLength(1);
    const call = ok.calls[0]!;
    expect(call.url).toBe("https://perminister.test/api/auth/consumer/token");
    expect(call.init.method).toBe("POST");
    const headers = new Headers(call.init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-perminister-client-id")).toBe("test-client-id");
    expect(headers.get("x-perminister-client-secret")).toBe(CLIENT_SECRET);
    expect(JSON.parse(call.init.body as string)).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      code_verifier: "the-verifier",
    });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    expect(tokens.accessToken).toBe("perminister-session-token");
    expect(tokens.accessTokenExpiresAt).toEqual(
      new Date("2030-01-01T00:00:00.000Z"),
    );
    expect(tokens.raw).toEqual(exchange);

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

  it("getToken refuses a 200 answer without account.subjectId", async () => {
    const { fetch: f } = stubFetch(() =>
      Response.json({ ...exchange, account: { email: "a@example.com" } }),
    );
    await expect(
      provider(f).getToken!({
        code: "c",
        redirectURI: "x",
        codeVerifier: "v",
      }),
    ).rejects.toThrow(/200/);
  });

  it("getUserInfo maps the exchange to the profile, or null without a subjectId", async () => {
    const p = provider(stubFetch(() => new Response(null)).fetch);
    const profile = await p.getUserInfo!({ raw: exchange });
    expect(profile).toEqual({
      id: "subject-1",
      subjectId: "subject-1",
      email: "Ann@Example.com",
      name: "Ann Lee",
      emailVerified: true,
      organizations: exchange.organizations,
    });
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
