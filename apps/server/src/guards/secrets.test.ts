import { describe, expect, it } from "vitest";
import { scanForSecrets, shannonEntropy } from "./secrets.ts";

// Every fixture of spec.md Interfaces -> Secret rules. Secret-shaped strings are assembled at
// run time from pieces, so no secret-shaped literal sits in the repo.

/** Deterministic mixed-case alphanumeric text of length n (high entropy). */
function alnum(n: number, seed = 7): string {
  const chars =
    "aB3cD5eF7gH9iJ2kL4mN6oP8qR0sT1uV3wX5yZ7AbCdEfGhJkMnPqRsTuVwXyZ2468";
  let out = "";
  let x = seed;
  for (let i = 0; i < n; i += 1) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out += chars[x % chars.length];
  }
  return out;
}

function base32(n: number, seed = 3): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let out = "";
  let x = seed;
  for (let i = 0; i < n; i += 1) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out += chars[x % chars.length];
  }
  return out;
}

const githubPat = "gh" + "p_" + alnum(36, 11);
const openaiKey = "sk-" + alnum(20, 16) + "T3Blbk" + "FJ" + alnum(20, 17);
const pem = (label: string) =>
  "-----BEGIN " +
  label +
  "-----\n" +
  alnum(64, 19) +
  "\n" +
  alnum(64, 20) +
  "\n" +
  alnum(40, 21) +
  "\n-----END " +
  label +
  "-----";

function body(value: string) {
  return [{ name: "body", value }];
}

// [label, text, rule]
const mustRefuse: [string, string, string][] = [
  ["an AWS access key", "AK" + "IA" + base32(16), "aws-access-token"],
  ["an AWS temporary key", "AS" + "IA" + base32(16, 4), "aws-access-token"],
  ["a GitHub token", githubPat, "github-pat"],
  ["a GitHub token of one letter", "gh" + "p_" + "A".repeat(36), "github-pat"],
  ["a GitHub OAuth token", "gh" + "o_" + alnum(36, 12), "github-oauth"],
  ["a GitHub app token", "gh" + "s_" + alnum(36, 13), "github-app-token"],
  ["a GitHub user token", "gh" + "u_" + alnum(36, 14), "github-app-token"],
  [
    "a GitHub fine-grained token",
    "github" + "_pat_" + alnum(82, 14),
    "github-fine-grained-pat",
  ],
  [
    "an Anthropic key",
    "sk-" + "ant-" + "api03-" + alnum(93, 15) + "AA",
    "anthropic-api-key",
  ],
  ["an OpenAI key", openaiKey, "openai-api-key"],
  ["a GCP API key", "AI" + "za" + alnum(35, 18), "gcp-api-key"],
  ["a private key block", pem("RSA PRIVATE KEY"), "private-key"],
  ["an OpenSSH private key block", pem("OPENSSH PRIVATE KEY"), "private-key"],
  [
    "an OPENAI_API_KEY= line",
    "OPENAI" + "_API_KEY=" + openaiKey,
    "openai-api-key",
  ],
  [
    "a DB_PASSWORD= line with a high-entropy value",
    "export DB_PASSWORD=" + "Zx9" + "qL2vB7mN4pR8wT6k",
    "generic-secret",
  ],
  [
    "a quoted secret: line in a body",
    "notes\n  client_secret: '" + "Zx9" + "qL2vB7mN4pR8wT6k'\nmore",
    "generic-secret",
  ],
];

const mustAccept: [string, string][] = [
  ["an AWS prefix alone", "AKIA is the prefix of AWS access keys"],
  ["a UUID", "See 6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b for details."],
  ["a git sha", "Fixed in 3f786850e387550fdab836ed7e6dc881de23001b."],
  ["a placeholder API_KEY line", "API_KEY=<your key here>"],
  ["a variable name", "set GITHUB_TOKEN in your environment"],
  ["a public key block", pem("PUBLIC KEY")],
  ["a masked password", "password: ********"],
  [
    "a ${VAR} reference",
    "export AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}",
  ],
  ["a $VAR reference", "GITHUB_TOKEN=$GITHUB_TOKEN_FROM_CI"],
  ["a changeme value", "DB_PASSWORD=changeme-changeme-123"],
  ["an example value", "API_TOKEN=example-token-value"],
  ["a your-value", "SECRET_KEY=yourSecretKeyGoesHere"],
  ["a low-entropy value", "PASSWORD=aaaaaaabbbbbbbb"],
  ["a short value", "API_KEY=Zx9qL2vB"],
  [
    "a sentence after a key name",
    "Key: we rotate them every month in the vault",
  ],
  ["empty input", ""],
];

describe("scanForSecrets", () => {
  for (const [label, text, rule] of mustRefuse) {
    it(`refuses ${label} (${rule})`, () => {
      expect(scanForSecrets(body(text))).toEqual({ field: "body", rule });
    });
  }

  it("refuses a ref https://user:<github-pat>@github.com/o/r and names the ref", () => {
    const fields = [
      { name: "title", value: "Clone" },
      { name: "body", value: "plain text" },
      { name: "refs.0", value: "https://github.com/o/r" },
      { name: "refs.1", value: `https://user:${githubPat}@github.com/o/r` },
    ];
    expect(scanForSecrets(fields)).toEqual({
      field: "refs.1",
      rule: "github-pat",
    });
  });

  it("names the first field with a hit and never the matched text", () => {
    const hit = scanForSecrets([
      { name: "title", value: "fine" },
      { name: "body", value: "token " + githubPat },
      { name: "refs.0", value: openaiKey },
    ]);
    expect(hit).toEqual({ field: "body", rule: "github-pat" });
    expect(JSON.stringify(hit)).not.toContain(githubPat);
  });

  for (const [label, text] of mustAccept) {
    it(`accepts ${label}`, () => {
      expect(scanForSecrets(body(text))).toBeUndefined();
    });
  }

  it("accepts no fields at all", () => {
    expect(scanForSecrets([])).toBeUndefined();
  });

  it("scans a large body and gives the same answer twice", () => {
    const big = "lorem ipsum ".repeat(5000) + "\nkey " + githubPat;
    const fields = body(big);
    expect(scanForSecrets(fields)).toEqual({
      field: "body",
      rule: "github-pat",
    });
    expect(scanForSecrets(fields)).toEqual({
      field: "body",
      rule: "github-pat",
    });
  });
});

describe("shannonEntropy", () => {
  it("is 0 for one repeated character and log2(n) for n distinct ones", () => {
    expect(shannonEntropy("")).toBe(0);
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("abcd")).toBeCloseTo(2);
    expect(shannonEntropy("Zx9qL2vB7mN4pR8wT6k")).toBeGreaterThanOrEqual(3.5);
  });
});
