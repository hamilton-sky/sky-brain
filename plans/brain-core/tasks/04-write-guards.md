# Build the write guards: secret scan, quarantine detector and per-actor rate limiter

Type: task
Status: open
Blocked by: 01
Test first: yes
Level: 3
Builder: backend
Touches: apps/server/src/guards/

Three pure modules with no database and no Express, so they can be built beside the schema and
tested exhaustively with fixtures. The post ticket wires them into the routes.

`apps/server/src/guards/secrets.ts` (new): `scanForSecrets(fields: { name: string; value: string
}[])` returns `undefined` or `{ field, rule }` for the first hit, never the matched text. Rules
and the must-refuse and must-accept lists are in spec.md Interfaces → Secret rules (modelled on
gitleaks v8.28.0; regexes in map.md's source). The generic rule needs Shannon entropy of at least
3.5 and skips placeholders.

`apps/server/src/guards/quarantine.ts` (new): `detectInjection(text: string)` returns
`undefined` or the id of the first pattern that matches, in the order of spec.md Interfaces →
Quarantine patterns: `ignore-instructions`, `role-override`, `role-tag`, `tool-call`,
`agent-order` (`source-web` is not a text pattern: the post ticket sets it from `source`). The
id becomes the entry's `quarantined_because`. Patterns aim at
injection signatures (ignore/disregard/forget + previous/prior/above/earlier + instructions,
prompts, directions or messages; "you are now …"; role and tool tags such as `<system>`,
`<|im_start|>`, `[INST]`, `<tool_use>`, `<function_calls>`, `<invoke name=`; JSON
`"tool_calls"` / `"function_call"` shapes; orders addressed to an AI, assistant, agent or model
"reading this"), not at ordinary imperatives, so a person's rule like "Always run the tests
before you push." passes. Match case-insensitively. The fixture lists, and the id each must-quarantine text gets, are in
spec.md Interfaces → Quarantine patterns.

`apps/server/src/guards/ratelimit.ts` (new): `createRateLimiter({ capacity, refillPerSecond,
now })` with `take(key)` returning `{ ok: true }` or `{ ok: false, retryAfterSeconds }` (a token
bucket per key; `retryAfterSeconds` is the whole seconds until one token is back, at least 1).
Buckets that have been full for over ten minutes are dropped on access, so memory stays bounded
by active actors. Defaults: capacity 60, refill 1 per second. In memory, one instance (brief).

Fixtures that look like secrets are assembled at run time from pieces (for example
`"gh" + "p_" + "A".repeat(36)`), never written as one literal, so no secret-shaped string sits in
the repo (GitHub push protection, and any future secret scan of the repo).

## Not in this ticket

- Calling the guards from routes, the 422 / 429 responses and `quarantined_because`: the post
  ticket (05).
- Size caps: they are zod limits in the request schemas of the post ticket (05).

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/guards --reporter=verbose` passes, with a
  test for every must-refuse and must-accept secret fixture and every must-quarantine and
  must-not-quarantine text in spec.md Interfaces (each must-quarantine text asserted against
  its id), and the test names contain the `prints` lines of the check block below.
- The rate limiter tests show a burst over capacity refused with a `retryAfterSeconds`, refill
  after the clock moves, and one key not affecting another.
- `grep -rE "ghp_[0-9A-Za-z]{36}|AKIA[A-Z2-7]{16}" apps/server/src` finds nothing.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/guards --reporter=verbose
prints refuses a GitHub token
prints refuses a private key block
prints accepts a placeholder API_KEY line
prints quarantines ignore previous instructions
prints does not quarantine an ordinary rule
prints names the pattern that matched
prints refuses a burst over capacity
prints keeps actors apart
$ grep -rE "ghp_[0-9A-Za-z]{36}|AKIA[A-Z2-7]{16}" apps/server/src
exit nonzero
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Interfaces (Secret rules, Quarantine patterns), § Decisions (quarantine, secret
  scan, rate limit)
- map.md § Decisions so far (gitleaks v8.28.0 source, OWASP)

## Answer
