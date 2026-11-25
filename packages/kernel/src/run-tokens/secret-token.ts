// Opaque secrets (spec.md Decisions -> opaque tokens stored as SHA-256 hashes): the device
// credential (`sbd_`) and run tokens (`sbr_`). Only the hash is ever stored; a request's token is
// hashed and looked up by that hash, so no stored secret is compared in application code.
import { createHash, randomBytes } from "node:crypto";

export type SecretTokenPrefix = "sbd" | "sbr";

/** 32 random bytes, base64url, behind the prefix: `sbd_<43 chars>`. */
export function newSecretToken(prefix: SecretTokenPrefix): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

/** SHA-256 hex of a token: what the database stores and looks up. */
export function hashSecretToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
