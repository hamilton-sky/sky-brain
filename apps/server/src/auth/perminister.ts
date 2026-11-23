// "Sign in with Perminister" as a Better Auth generic OAuth provider, using Perminister's
// OpenID Connect flow (its docs/api.md, "Sign in with Perminister"). perminister-oidc.ts finishes
// the authorize URL; getToken exchanges the code at /oauth/token, checks the ID token, then reads
// the account and its organizations from /api/auth/consumer/session with the new access token.
import type { GenericOAuthConfig } from "better-auth/plugins";
import {
  PERMINISTER_SCOPE,
  nonceFor,
  s256,
  verifyIdToken,
} from "./perminister-oidc.ts";

export interface PerministerOptions {
  /** `PERMINISTER_BASE_URL`: an origin with no trailing slash. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** sky-brain's own origin; Perminister calls back to `<publicUrl>/auth/perminister/callback`. */
  publicUrl: string;
  /** Keys the nonce (perminister-oidc.ts): sky-brain's BETTER_AUTH_SECRET. */
  nonceKey: string;
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
  const redirectURI = `${publicUrl}/auth/perminister/callback`;
  return {
    providerId: "perminister",
    name: "Perminister",
    clientId,
    clientSecret,
    authorizationUrl: `${baseUrl}/oauth/authorize`,
    redirectURI,
    pkce: true,
    scopes: PERMINISTER_SCOPE.split(" "),
    accountSubject: ({ profile }) => {
      const subjectId = str(profile.subjectId);
      if (!subjectId) throw new Error("Perminister profile has no subjectId");
      return subjectId;
    },
    async getToken({ code, codeVerifier }) {
      if (!codeVerifier) throw new Error("Perminister sign-in needs PKCE");
      // No answer body and never the secret go into a log or an error message.
      const basic = Buffer.from(
        `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
      ).toString("base64");
      const res = await options.fetch(`${baseUrl}/oauth/token`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          // The URI the authorize request carried. Better Auth hands getToken its own default
          // callback here, which Perminister would refuse as a different redirect URI.
          redirect_uri: redirectURI,
          code_verifier: codeVerifier,
        }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status !== 200) {
        await res.body?.cancel();
        throw new Error(
          `Perminister token exchange failed with status ${res.status}`,
        );
      }
      const token: unknown = await res.json().catch(() => undefined);
      const accessToken = isRecord(token) ? str(token.access_token) : undefined;
      const idToken = isRecord(token) ? str(token.id_token) : undefined;
      if (
        !isRecord(token) ||
        !accessToken ||
        !idToken ||
        token.token_type !== "Bearer"
      ) {
        throw new Error("Perminister token exchange answered without tokens");
      }
      const jwksRes = await options.fetch(`${baseUrl}/.well-known/jwks.json`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (jwksRes.status !== 200) {
        await jwksRes.body?.cancel();
        throw new Error(`Perminister JWKS answered status ${jwksRes.status}`);
      }
      const subject = verifyIdToken(idToken, {
        issuer: new URL(baseUrl).origin,
        clientId,
        nonce: nonceFor(options.nonceKey, s256(codeVerifier)),
        jwks: await jwksRes.json(),
      });
      // The account and its organizations (productIds decide mayEnter, access.ts).
      const sessionRes = await options.fetch(
        `${baseUrl}/api/auth/consumer/session`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
            "x-perminister-client-id": clientId,
            "x-perminister-client-secret": clientSecret,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (sessionRes.status !== 200) {
        await sessionRes.body?.cancel();
        throw new Error(
          `Perminister session answered status ${sessionRes.status}`,
        );
      }
      const raw: unknown = await sessionRes.json().catch(() => undefined);
      const account = accountOf(raw);
      if (!isRecord(raw) || raw.authenticated !== true || !account) {
        throw new Error("Perminister session answered without an account");
      }
      if (account.subjectId !== subject) {
        throw new Error(
          "Perminister session and ID token name different subjects",
        );
      }
      const expiresIn = token.expires_in;
      const expiresAt =
        typeof expiresIn === "number" && expiresIn > 0
          ? new Date(Date.now() + expiresIn * 1000)
          : undefined;
      return {
        accessToken,
        ...(expiresAt ? { accessTokenExpiresAt: expiresAt } : {}),
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
