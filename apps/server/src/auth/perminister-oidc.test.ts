import { describe, expect, it } from "vitest";
import {
  PERMINISTER_SCOPE,
  nonceFor,
  padState,
  s256,
  stripStateSuffix,
  toPerministerAuthorizeUrl,
} from "./perminister-oidc.ts";

const KEY = "test-better-auth-secret-at-least-32-chars";
const BASE = "https://perminister.test";
const B64_43 = /^[A-Za-z0-9_-]{43}$/;

function betterAuthUrl(
  state = "a".repeat(32),
  challenge = s256("v".repeat(43)),
) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: "c",
    state,
    redirect_uri: "https://brain.test/auth/perminister/callback",
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  return `${BASE}/oauth/authorize?${q.toString()}`;
}

describe("perminister OIDC authorize URL", () => {
  it("adds the scope, a 43-character nonce and a 43-character state Perminister requires", () => {
    const challenge = s256("v".repeat(43));
    const q = new URL(toPerministerAuthorizeUrl(betterAuthUrl(), BASE, KEY))
      .searchParams;
    expect(q.get("scope")).toBe(PERMINISTER_SCOPE);
    expect(q.get("nonce")).toMatch(B64_43);
    expect(q.get("nonce")).toBe(nonceFor(KEY, challenge));
    expect(q.get("state")).toMatch(B64_43);
    expect(q.get("state")!.startsWith("a".repeat(32))).toBe(true);
    expect(q.get("client_id")).toBe("c");
  });

  it("leaves any other URL alone", () => {
    const other = "https://elsewhere.test/oauth/authorize?state=x";
    expect(toPerministerAuthorizeUrl(other, BASE, KEY)).toBe(other);
  });

  it("the nonce differs per challenge and per key", () => {
    expect(nonceFor(KEY, "a")).not.toBe(nonceFor(KEY, "b"));
    expect(nonceFor(KEY, "a")).not.toBe(nonceFor(`${KEY}x`, "a"));
  });

  it("strips only a suffix padState made", () => {
    const own = "Ab_-".repeat(8);
    const padded = padState(own);
    expect(padded).toMatch(B64_43);
    expect(stripStateSuffix(padded)).toBe(own);
    const forged = own + "x".repeat(11);
    expect(stripStateSuffix(forged)).toBe(forged);
    expect(stripStateSuffix("short")).toBe("short");
  });
});
