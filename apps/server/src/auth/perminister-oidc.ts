// Perminister's OpenID Connect sign-in (its docs/api.md, "Sign in with Perminister", since
// 2026-11-14). Perminister refuses an authorize request unless it carries
// `scope=openid profile email perminister_api`, a 43-character `nonce` and a 43-character
// `state`. Better Auth 1.7.15 makes a 32-character state and only sends a nonce for providers
// with discovery, so `toPerministerAuthorizeUrl` finishes the URL Better Auth built:
// - state: Better Auth's own state plus an 11-character suffix derived from it. The callback
//   route takes the suffix off again (`stripStateSuffix`), so Better Auth checks its own state.
// - nonce: an HMAC of the PKCE challenge under sky-brain's secret. getToken only learns the
//   verifier, recomputes the challenge and the nonce from it, and checks the ID token's nonce.
//   So the ID token is bound to this one authorization request, with nothing stored.
import {
  createHash,
  createHmac,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";

export const PERMINISTER_SCOPE = "openid profile email perminister_api";

const BETTER_AUTH_STATE = /^[A-Za-z0-9_-]{32}$/;
const PADDED_STATE = /^[A-Za-z0-9_-]{43}$/;

function b64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/** The PKCE S256 challenge of a verifier. */
export function s256(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

/** 43 base64url characters, bound to one PKCE challenge. */
export function nonceFor(key: string, codeChallenge: string): string {
  return b64url(
    createHmac("sha256", key)
      .update(`perminister-nonce:${codeChallenge}`)
      .digest(),
  );
}

function suffixOf(state: string): string {
  return b64url(
    createHash("sha256").update(`perminister-state:${state}`).digest(),
  ).slice(0, 11);
}

/** A 32-character Better Auth state padded to the 43 characters Perminister asks for. */
export function padState(state: string): string {
  return BETTER_AUTH_STATE.test(state) ? state + suffixOf(state) : state;
}

/** The state Better Auth made, when `state` is one `padState` padded; else `state` as is. */
export function stripStateSuffix(state: string): string {
  if (!PADDED_STATE.test(state)) return state;
  const own = state.slice(0, 32);
  return suffixOf(own) === state.slice(32) ? own : state;
}

/**
 * Better Auth's Perminister authorize URL with the scope, nonce and state Perminister requires.
 * Any other URL comes back unchanged.
 */
export function toPerministerAuthorizeUrl(
  url: string,
  perministerBaseUrl: string,
  key: string,
): string {
  if (!url.startsWith(`${perministerBaseUrl}/oauth/authorize?`)) return url;
  const parsed = new URL(url);
  const q = parsed.searchParams;
  const state = q.get("state");
  const challenge = q.get("code_challenge");
  if (!state || !challenge) return url;
  q.set("state", padState(state));
  q.set("scope", PERMINISTER_SCOPE);
  q.set("nonce", nonceFor(key, challenge));
  return parsed.toString();
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function segment(part: string): Json {
  const parsed: unknown = JSON.parse(
    Buffer.from(part, "base64url").toString("utf8"),
  );
  if (!isRecord(parsed)) throw new Error("Perminister ID token is malformed");
  return parsed;
}

export interface IdTokenCheck {
  issuer: string;
  clientId: string;
  nonce: string;
  jwks: unknown;
  now?: number;
}

/** What sky-brain reads from a checked ID token. */
export interface IdTokenClaims {
  subject: string;
  /** Perminister's `email_verified` claim; false when it is missing or anything but `true`. */
  emailVerified: boolean;
}

/**
 * Checks an RS256 ID token's signature, issuer, audience, expiry and nonce; returns its `sub`
 * and whether Perminister says the email is verified.
 */
export function verifyIdToken(
  idToken: string,
  check: IdTokenCheck,
): IdTokenClaims {
  const fail = (why: string): never => {
    throw new Error(`Perminister ID token refused: ${why}`);
  };
  if (idToken.length > 16_384) fail("too long");
  const parts = idToken.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) fail("malformed");
  const [h, p, sig] = parts as [string, string, string];
  const header = segment(h);
  const payload = segment(p);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    fail("not RS256 with a kid");
  }
  const keys =
    isRecord(check.jwks) && Array.isArray(check.jwks.keys)
      ? (check.jwks.keys as unknown[])
      : [];
  const jwk = keys.find(
    (k) => isRecord(k) && k.kid === header.kid && k.kty === "RSA",
  );
  if (!jwk) fail("no signing key with its kid");
  const publicKey = createPublicKey({ key: jwk as never, format: "jwk" });
  if (
    !verifySignature(
      "RSA-SHA256",
      Buffer.from(`${h}.${p}`, "utf8"),
      publicKey,
      Buffer.from(sig, "base64url"),
    )
  ) {
    fail("bad signature");
  }
  const now = check.now ?? Math.floor(Date.now() / 1000);
  const aud =
    typeof payload.aud === "string"
      ? [payload.aud]
      : Array.isArray(payload.aud)
        ? payload.aud
        : [];
  if (payload.iss !== check.issuer) fail("issuer");
  if (!aud.includes(check.clientId)) fail("audience");
  if (aud.length > 1 && payload.azp !== check.clientId) fail("azp");
  if (typeof payload.exp !== "number" || payload.exp <= now) fail("expired");
  if (payload.nonce !== check.nonce) fail("nonce");
  if (typeof payload.sub !== "string" || payload.sub === "") fail("no sub");
  return {
    subject: payload.sub as string,
    emailVerified: payload.email_verified === true,
  };
}
