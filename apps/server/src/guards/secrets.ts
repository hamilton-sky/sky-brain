// The secret scan (spec.md Interfaces -> Secret rules), modelled on gitleaks v8.28.0.
// A hit names the field and the rule, never the matched text.

export type SecretHit = { field: string; rule: string };

// Provider rules: gitleaks v8.28.0 regexes, in the order spec.md lists them.
const PROVIDER_RULES: { rule: string; pattern: RegExp }[] = [
  {
    rule: "aws-access-token",
    pattern: /\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/,
  },
  { rule: "github-pat", pattern: /ghp_[0-9a-zA-Z]{36}/ },
  { rule: "github-oauth", pattern: /gho_[0-9a-zA-Z]{36}/ },
  { rule: "github-app-token", pattern: /(?:ghu|ghs)_[0-9a-zA-Z]{36}/ },
  { rule: "github-fine-grained-pat", pattern: /github_pat_\w{82}/ },
  {
    rule: "anthropic-api-key",
    pattern: /\b(sk-ant-api03-[a-zA-Z0-9_-]{93}AA)(?:[`'"\s;]|\\[nr]|$)/,
  },
  {
    rule: "openai-api-key",
    pattern:
      /\b(sk-(?:proj|svcacct|admin)-(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})T3BlbkFJ(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})\b|sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20})(?:[`'"\s;]|\\[nr]|$)/,
  },
  { rule: "gcp-api-key", pattern: /\b(AIza[\w-]{35})(?:[`'"\s;]|\\[nr]|$)/ },
  {
    rule: "private-key",
    pattern:
      /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S-]{64,}?KEY(?: BLOCK)?-----/i,
  },
];

// generic-secret: a line `[export] NAME=value` or `NAME: value`.
const ASSIGNMENT = /^\s*(?:export\s+)?([\w.-]+)\s*[:=]\s*(.*?)\s*;?\s*$/;
const SECRET_NAME = /key|secret|token|passw(?:or)?d|credential/i;
const MIN_LENGTH = 12;
const MIN_ENTROPY = 3.5;
const PLACEHOLDERS = [
  /^<[^>]*>$/, // <...>
  /^\$\{[^}]*\}$/, // ${...}
  /^\$[A-Za-z_]\w*$/, // $VAR
  /^(.)\1*$/, // one repeated character
  /changeme/i,
  /example/i,
  /^your/i,
];

/** Shannon entropy of `text`, in bits per character. */
export function shannonEntropy(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function unquote(value: string): string {
  const q = value[0];
  if (
    value.length >= 2 &&
    (q === '"' || q === "'" || q === "`") &&
    value.endsWith(q)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isGenericSecret(line: string): boolean {
  const m = ASSIGNMENT.exec(line);
  if (!m) return false;
  const [, name = "", raw = ""] = m;
  if (!SECRET_NAME.test(name)) return false;
  const value = unquote(raw);
  // A secret value is one token; text with spaces after `Key:` is prose.
  if (value.length < MIN_LENGTH || /\s/.test(value)) return false;
  if (PLACEHOLDERS.some((p) => p.test(value))) return false;
  return shannonEntropy(value) >= MIN_ENTROPY;
}

function ruleFor(value: string): string | undefined {
  for (const { rule, pattern } of PROVIDER_RULES) {
    if (pattern.test(value)) return rule;
  }
  if (value.split(/\r?\n/).some(isGenericSecret)) return "generic-secret";
  return undefined;
}

/** The first field holding a secret and the rule it hit, or undefined when none does. */
export function scanForSecrets(
  fields: { name: string; value: string }[],
): SecretHit | undefined {
  for (const { name, value } of fields) {
    const rule = ruleFor(value);
    if (rule) return { field: name, rule };
  }
  return undefined;
}
