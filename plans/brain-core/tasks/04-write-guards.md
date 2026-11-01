# Build the write guards: secret scan, quarantine detector and per-actor rate limiter

Type: task
Status: resolved
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

Work started at commit `c7a6b671d54ec43eec95dadd9b1155a01597bfd6`. Failing tests committed alone
first as `6883775 test(brain-core): 04 failing test` (all three files failed with "Cannot find
module").

**Built**
- `apps/server/src/guards/secrets.ts` (new): `scanForSecrets(fields)` returns `undefined` or
  `{ field, rule }` (type `SecretHit`); also exports `shannonEntropy(text)`.
- `apps/server/src/guards/quarantine.ts` (new): `detectInjection(text)` returns `undefined` or
  `ignore-instructions` | `role-override` | `role-tag` | `tool-call` | `agent-order`.
- `apps/server/src/guards/ratelimit.ts` (new): `createRateLimiter({ capacity?, refillPerSecond?,
  now? })` returns `{ take(key), size() }`; types `TakeResult`, `RateLimiter`,
  `RateLimiterOptions`.
- Tests beside them: `secrets.test.ts`, `quarantine.test.ts`, `ratelimit.test.ts`.

**Proof** (all run fresh after the last edit)
- `pnpm --filter @sky-brain/server exec vitest run src/guards --reporter=verbose`: 71 passed (3
  files). Every must-refuse secret (9 provider shapes plus ASIA and ghu variants, the
  `OPENAI_API_KEY=` line, the `export DB_PASSWORD=` line as `generic-secret`, the
  `https://user:<github-pat>@github.com/o/r` ref named as field `refs.1`) and every must-accept
  text of spec.md (AKIA prefix, UUID, git sha, `API_KEY=<your key here>`, `set GITHUB_TOKEN…`,
  PUBLIC KEY block, `password: ********`) has its own test. All 15 must-quarantine texts are
  asserted against their ids (one test each, plus "names the pattern that matched, for every
  spec example"), the 5 must-not-quarantine texts each have a test. Output contains every
  `prints` line: "refuses a GitHub token (github-pat)", "refuses a private key block
  (private-key)", "accepts a placeholder API_KEY line", "quarantines ignore previous
  instructions", "does not quarantine an ordinary rule", "names the pattern that matched, for
  every spec example", "refuses a burst over capacity with retryAfterSeconds", "keeps actors
  apart".
- Rate limiter: "refuses a burst over capacity with retryAfterSeconds" (capacity 3: 4th take is
  `{ ok: false, retryAfterSeconds: 1 }`), "refills after the clock moves" (after `advance(1)` one
  more take is ok, and refill caps at capacity), "keeps actors apart" (an exhausted `human:a`
  leaves `agent:x:a` and `human:b` ok), plus whole-second rounding (10, 8, 1 at 0.1/s), defaults
  60 and 1/s, and the ten-minute drop (`size()` 2 → 1).
- `grep -rE "ghp_[0-9A-Za-z]{36}|AKIA[A-Z2-7]{16}" apps/server/src`: no output, exit 1.
- `pnpm lint && pnpm typecheck && pnpm test`: exit 0. "All matched files use Prettier code
  style!", shared 15/15, server 141/141 (14 files).

**Decisions**
- Provider regexes are copied from gitleaks v8.28.0's `gitleaks.toml` (fetched and read), with
  `` \x60 `` written as a backtick. Their per-rule entropy floors (3 or 4) are not applied: the
  spec puts the entropy floor on the generic rule only, and the ticket's own example fixture
  `"gh" + "p_" + "A".repeat(36)` must be refused (it would pass gitleaks' entropy 3).
- Rules are tried in spec order, providers before `generic-secret`, so an `OPENAI_API_KEY=` line
  with a real-shaped key reports `openai-api-key`. Fields are scanned in the order given; the
  first field with any hit wins.
- `generic-secret` is the spec's line rule, applied per line: `^[export] NAME (=|:) value$`,
  NAME matching `key|secret|token|passw(or)d|credential` (any case), value unquoted (`'`, `"`,
  backtick), at least 12 characters, entropy at least 3.5, not a placeholder (`<...>`, `${...}`,
  `$VAR`, one repeated character, contains `changeme` or `example`, starts with `your`). A value
  that contains whitespace is not a secret (gitleaks' value class has no spaces), so prose such
  as "Key: we rotate them every month in the vault" passes.
- Quarantine patterns go a little beyond the spec examples, toward the signatures the ticket
  lists: `ignore-instructions` also takes `preceding`, `rules`, `commands` and up to three filler
  words (all, any, the, your, …); `role-tag` takes `<assistant>`, `<|im_end|>`, `<<SYS>>`;
  `tool-call` takes `<tool_result>`; `agent-order` takes "<AI|assistant|agent|model|LLM|bot>
  reading this" or an address "Assistant, you must/should/will/now/need…" at the start of a
  sentence. `<user>` is left out of `role-tag` on purpose: docs use it as a placeholder
  (`human:<user>`). `role-override` needs "you are now" followed by `in <x> mode`, a/an/the/my,
  acting, unrestricted, jailbroken or DAN, so "you are now able to…" passes.
- Rate limiter clock is in milliseconds (`now` defaults to `Date.now`). Idle buckets are swept
  on every `take`; a bucket is dropped when the time since it became full is over ten minutes
  (dropping a full bucket is invisible, a new one starts full). Bad options throw an `Error`
  naming the option (capacity must be a whole number ≥ 1, refillPerSecond finite and > 0).
- `size()` is added to the limiter beside `take(key)` so the memory bound is testable; it
  changes nothing in `take`'s shape.

**Shortcuts taken**
- The idle sweep walks every bucket on each `take`: O(active actors) per write. Fine for one
  instance and a small team; if write volume or actor count grows, sweep at most once per
  minute or keep buckets ordered by time.
- One in-memory limiter per process: limits are per instance and reset on restart (the brief
  accepts a single instance). A second instance needs a shared store.
- Pattern screening is not a security boundary (OWASP, map.md); a paraphrased injection gets
  through. The boundary stays the trust rules and the fenced packet.

**For later tickets**
- 05: import `scanForSecrets` from `src/guards/secrets.ts` and pass fields named as the 422 should
  name them (`title`, `body`, `refs.<index>`): the hit's `field` is the `name` you passed. The
  hit never carries the matched text. `detectInjection` returns the id for
  `quarantined_because`; `source-web` is yours to set. `createRateLimiter({ capacity,
  refillPerSecond })` matches the `rateLimit` option shape; use `retryAfterSeconds` for
  `Retry-After`, and `actorKey(actor)` as the key.
