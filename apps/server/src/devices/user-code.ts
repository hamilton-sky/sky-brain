// RFC 8628 user codes: 8 characters from a 20-letter set with no vowels (about 34.5 bits), shown
// as XXXX-XXXX, matched ignoring case and the dash.
import { randomInt } from "node:crypto";

const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const LENGTH = 8;
const STORED = /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/;

/** A new user code as stored: eight letters, no dash. */
export function newUserCode(): string {
  let code = "";
  for (let i = 0; i < LENGTH; i += 1)
    code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** The stored code as shown to a person: XXXX-XXXX. */
export function formatUserCode(stored: string): string {
  return `${stored.slice(0, 4)}-${stored.slice(4)}`;
}

/** What a person typed, as stored; null when it cannot be a user code. */
export function normalizeUserCode(typed: string): string | null {
  const code = typed.replace(/-/g, "").toUpperCase();
  return STORED.test(code) ? code : null;
}
