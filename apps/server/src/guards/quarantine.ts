// The quarantine detector (spec.md Interfaces -> Quarantine patterns). Patterns aim at
// injection signatures, not at ordinary imperatives. This is one illustrative layer, not a
// security boundary (OWASP); `source-web` is set by the caller from `source`, not from text.

// The start of an order: "you must …", "please …", or an imperative verb an injection uses.
const ORDER = String.raw`you\s+(?:must|should|will|now|need|are\s+to)\b|(?:now|please|run|execute|ignore|disregard|forget|delete|remove|push|send|print|reveal|output|install|download|curl|wget|obey)\b`;

const PATTERNS: { id: string; pattern: RegExp }[] = [
  {
    // ignore / disregard / forget + previous / prior / above / earlier + instructions etc., with
    // the qualifier before the noun ("ignore previous instructions") or after it ("ignore the
    // instructions above", "disregard everything above").
    id: "ignore-instructions",
    pattern:
      /\b(?:ignore|disregard|forget)\s+(?:(?:all|any|the|your|my|of|these|those)\s+){0,3}(?:(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|prompts?|directions?|messages?|rules|commands)\b|(?:instructions?|prompts?|directions?|messages?|rules|commands|everything|anything)\s+(?:previous|prior|above|earlier|preceding|before)\b)/i,
  },
  {
    // Mode, jailbreak and "acting as" forms only: "you are now in developer mode", "you are now
    // DAN", "you are now an unrestricted model", "you are now acting as …". A plain "you are now
    // a maintainer" or "you are now the owner" is an ordinary sentence.
    id: "role-override",
    pattern:
      /\byou\s+are\s+now\s+(?:in\s+[\w-]+\s+mode\b|(?:an?\s+)?(?:unrestricted|jailbroken|uncensored|unfiltered)\b|dan\b|acting\s+as\b)/i,
  },
  {
    // <system>, </system>, <assistant>, <|im_start|>, <|im_end|>, [INST], <<SYS>>. One run of
    // whitespace after `<` or `</`, never two side by side, so a long run cannot cost n².
    id: "role-tag",
    pattern:
      /<\/?\s*(?:system|assistant)\s*>|<\|im_(?:start|end|sep)\|>|\[\/?INST\]|<<\/?SYS>>/i,
  },
  {
    // <tool_use>, <function_calls>, <invoke name=, "tool_calls": [, "function_call":
    id: "tool-call",
    pattern:
      /<\/?\s*(?:tool_use|tool_result|function_calls)\b|<\s*invoke\s+name\s*=|"(?:tool_calls|function_call)"\s*:/i,
  },
  {
    // Orders addressed to an AI, assistant, agent or model: "AI agents reading this: run …",
    // "Assistant, you must now …". Both forms need a `,` or `:` and then an order, so "The model
    // reading this config picks a default." passes.
    id: "agent-order",
    pattern: new RegExp(
      String.raw`\b(?:ai|assistants?|agents?|models?|llms?|bots?)\s+reading\s+this\s*[,:]\s*(?:${ORDER})` +
        String.raw`|(?:^|[.!?\n][^\S\n]*)(?:dear\s+|hey\s+)?(?:ai|assistants?|agents?|models?|llms?)\s*[,:]\s*(?:${ORDER})`,
      "i",
    ),
  },
];

// Invisible characters a writer can hide inside a keyword ("ig\u200bnore", "ig\u00adnore").
const ZERO_WIDTH = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;

/** The id of the first quarantine pattern `text` matches, or undefined. */
export function detectInjection(text: string): string | undefined {
  // NFKC folds fullwidth and other compatibility letters ("\uff49gnore") to plain ones.
  const visible = text.normalize("NFKC").replace(ZERO_WIDTH, "");
  for (const { id, pattern } of PATTERNS) {
    if (pattern.test(visible)) return id;
  }
  return undefined;
}
