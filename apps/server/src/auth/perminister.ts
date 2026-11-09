// "Sign in with Perminister" as a Better Auth generic OAuth provider (spec.md Interfaces ->
// Perminister calls). Written from Perminister's API reference (map.md); the token exchange is
// not a standard token endpoint, so getToken and getUserInfo are our own.
import type { GenericOAuthConfig } from "better-auth/plugins";

export interface PerministerOptions {
  /** `PERMINISTER_BASE_URL`: an origin with no trailing slash. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** sky-brain's own origin; Perminister calls back to `<publicUrl>/auth/perminister/callback`. */
  publicUrl: string;
  /** Every Perminister call goes through this, so tests can fake Perminister. */
  fetch: typeof fetch;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The exchange's `account`, when it names a subject. */
function accountOf(raw: unknown): Json | undefined {
  if (!isRecord(raw) || !isRecord(raw.account)) return undefined;
  return str(raw.account.subjectId) ? raw.account : undefined;
}

export function perministerProvider(
  options: PerministerOptions,
): GenericOAuthConfig<"perminister"> {
  const { baseUrl, clientId, clientSecret, publicUrl } = options;
  return {
    providerId: "perminister",
    name: "Perminister",
    clientId,
    clientSecret,
    authorizationUrl: `${baseUrl}/oauth/authorize`,
    redirectURI: `${publicUrl}/auth/perminister/callback`,
    pkce: true,
    accountSubject: ({ profile }) => {
      const subjectId = str(profile.subjectId);
      if (!subjectId) throw new Error("Perminister profile has no subjectId");
      return subjectId;
    },
    async getToken({ code, codeVerifier }) {
      if (!codeVerifier) throw new Error("Perminister sign-in needs PKCE");
      // The answer body and the secret are never logged or put in an error message.
      const res = await options.fetch(`${baseUrl}/api/auth/consumer/token`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-perminister-client-id": clientId,
          "x-perminister-client-secret": clientSecret,
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          code_verifier: codeVerifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status !== 200) {
        await res.body?.cancel();
        throw new Error(
          `Perminister token exchange failed with status ${res.status}`,
        );
      }
      const raw: unknown = await res.json().catch(() => undefined);
      if (!isRecord(raw) || !accountOf(raw) || !str(raw.sessionToken)) {
        throw new Error(
          `Perminister token exchange answered status ${res.status} without an account`,
        );
      }
      const expiresAt = isRecord(raw.session)
        ? new Date(str(raw.session.expiresAt) ?? Number.NaN)
        : undefined;
      return {
        accessToken: str(raw.sessionToken),
        ...(expiresAt && !Number.isNaN(expiresAt.getTime())
          ? { accessTokenExpiresAt: expiresAt }
          : {}),
        raw,
      };
    },
    getUserInfo(tokens) {
      const raw = tokens.raw;
      const account = accountOf(raw);
      if (!account) return Promise.resolve(null);
      const subjectId = str(account.subjectId)!;
      const email = str(account.email) ?? null;
      const fullName = [str(account.firstName), str(account.lastName)]
        .filter(Boolean)
        .join(" ");
      return Promise.resolve({
        id: subjectId,
        subjectId,
        email,
        name: fullName || email || subjectId,
        // Perminister refuses unverified self-service accounts itself (spec.md).
        emailVerified: true,
        organizations: isRecord(raw) ? (raw.organizations ?? []) : [],
      });
    },
  };
}
