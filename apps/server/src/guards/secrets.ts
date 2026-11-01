// The secret scan (spec.md Interfaces -> Secret rules), modelled on gitleaks v8.28.0.
// A hit names the field and the rule, never the matched text.

export type SecretHit = { field: string; rule: string };

// Provider rules: gitleaks v8.28.0 regexes, in the order spec.md lists them. Where gitleaks ends
// a key with a list of allowed next characters, a lookahead takes its place: the key must not
// run on into more key characters, so a key followed by `.`, `,`, `)`, `@` or `&` is still found.
// Where gitleaks starts or ends a key with `\b`, a lookaround for a letter or digit takes its
// place, so a key run straight on after or into `_` (`token_<key>`, `<key>_prod`) is still found.
const PROVIDER_RULES: { rule: string; pattern: RegExp }[] = [
  {
    rule: "aws-access-token",
    pattern:
      /(?<![A-Za-z0-9])((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})(?![A-Za-z0-9])/,
  },
  { rule: "github-pat", pattern: /ghp_[0-9a-zA-Z]{36}/ },
  { rule: "github-oauth", pattern: /gho_[0-9a-zA-Z]{36}/ },
  { rule: "github-app-token", pattern: /(?:ghu|ghs)_[0-9a-zA-Z]{36}/ },
  { rule: "github-fine-grained-pat", pattern: /github_pat_\w{82}/ },
  {
    rule: "anthropic-api-key",
    pattern: /(?<![A-Za-z0-9])(sk-ant-api03-[a-zA-Z0-9_-]{93}AA)(?![\w-])/,
  },
  {
    rule: "openai-api-key",
    pattern:
      /(?<![A-Za-z0-9])(sk-(?:proj|svcacct|admin)-(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})T3BlbkFJ(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})\b|sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20})(?![\w-])/,
  },
  { rule: "gcp-api-key", pattern: /(?<![A-Za-z0-9])(AIza[\w-]{35})(?![\w-])/ },
  {
    rule: "private-key",
    pattern:
      /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S-]{64,}?KEY(?: BLOCK)?-----/i,
  },
];

// generic-secret: a line `[export] NAME=value` or `NAME: value`, read from a trimmed line. NAME
// may be quoted (`"api_key": …`) and follow `{`, `,` or `const`/`let`/`var`. The value is
// everything after the first `:` or `=`, cleaned up in code (see `valueOf`), so no part of the
// pattern can backtrack over a long run of spaces. The whitespace after `{` or `,` is its own run,
// never next to the one after the keyword, so `export` + spaces cannot cost n².
const ASSIGNMENT =
  /^(?:(?:export|const|let|var)\s+)?(?:[{,]\s*)?["'`]?([\w.-]+)["'`]?\s*[:=]([\s\S]*)$/;
// A `name: "value"` pair anywhere on a line, so a secret that is not the first name on a
// one-line object (`{"user":"bob","api_key":"…"}`) is still found. The value must be quoted.
const PAIR = /(?:^|[{,\s])["'`]?([\w.-]+)["'`]?\s*:\s*(["'`])([^"'`\r\n]*)\2/g;
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
  /^(?:process\.env|import\.meta\.env|os\.environ)\b/, // a reference to the environment
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

/** The value of an assignment: no trailing `# comment`, `;`, `,` or `}`, and no quotes. */
function valueOf(raw: string): string {
  let value = raw.trim();
  const comment = value.search(/\s#/);
  if (comment >= 0) value = value.slice(0, comment).trimEnd();
  while (/[;,}]$/.test(value)) value = value.slice(0, -1).trimEnd();
  return unquote(value);
}

function isSecretAssignment(name: string, raw: string): boolean {
  if (!SECRET_NAME.test(name)) return false;
  const value = valueOf(raw);
  // A secret value is one token; text with spaces after `Key:` is prose.
  if (value.length < MIN_LENGTH || /\s/.test(value)) return false;
  if (PLACEHOLDERS.some((p) => p.test(value))) return false;
  return shannonEntropy(value) >= MIN_ENTROPY;
}

function isGenericSecret(line: string): boolean {
  const m = ASSIGNMENT.exec(line.trim());
  if (m && isSecretAssignment(m[1] ?? "", m[2] ?? "")) return true;
  for (const [, name = "", , value = ""] of line.matchAll(PAIR)) {
    if (isSecretAssignment(name, value)) return true;
  }
  return false;
}

function ruleFor(value: string): string | undefined {
  for (const { rule, pattern } of PROVIDER_RULES) {
    if (pattern.test(value)) return rule;
  }
  if (value.split(/\r\n|\r|\n/).some(isGenericSecret)) return "generic-secret";
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
