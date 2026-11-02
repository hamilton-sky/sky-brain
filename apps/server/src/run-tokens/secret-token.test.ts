import { describe, expect, it } from "vitest";
import { hashSecretToken, newSecretToken } from "./secret-token.ts";

describe("newSecretToken", () => {
  it("gives two different tokens, each with its prefix", () => {
    const a = newSecretToken("sbd");
    const b = newSecretToken("sbd");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^sbd_[A-Za-z0-9_-]{43}$/);
    expect(newSecretToken("sbr")).toMatch(/^sbr_[A-Za-z0-9_-]{43}$/);
  });
});

describe("hashSecretToken", () => {
  it("is SHA-256 hex, stable, and never the token itself", () => {
    const token = newSecretToken("sbr");
    const hash = hashSecretToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
    expect(hashSecretToken(token)).toBe(hash);
    expect(hashSecretToken(newSecretToken("sbr"))).not.toBe(hash);
  });
});
