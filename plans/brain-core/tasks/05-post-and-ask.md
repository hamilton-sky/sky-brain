# Add the post and ask routes with the trust rules, guards, claim expiry and audit rows

Type: task
Status: open
Blocked by: 02, 03, 04
Test first: yes
Level: 3
Touches: packages/shared/src/write.ts, apps/server/src/entries/, apps/server/src/http/, apps/server/src/app.ts, apps/server/src/testing/harness.ts, docs/DECISIONS.md

The heart of T4: `POST /api/v1/entries` and `POST /api/v1/ask`, with every rule of PLAN
section 6 for creating an entry. Everything a request can say about who wrote it is ignored.

`packages/shared/src/write.ts` (new): zod schemas `PostEntryInputSchema` and `AskInputSchema`
with the shapes in spec.md Interfaces → Routes. Title: one line (no `\r`, `\n` or other control
characters), at most 200 characters; body: at most 16,384 UTF-8 bytes; refs: at most 50, each at
most 2,048 characters; `confidence` 0..1; `kind: "answer"` needs `reply_to` and no `scope`,
every other kind needs `scope`. Unknown keys (`author`, `author_kind`, `on_behalf_of`,
`status`, ...) are stripped, not refused. A cap breach is 413 `too_large` with `field` exactly
as spec.md Interfaces → Size caps: `title`, `body`, `refs`, or `refs.<index>` for one ref over
2,048 characters (0-based, the zod issue path joined with `.`; the lowest index when several are
long), the first cap broken in that order; any other schema failure is 400 `invalid_request`.

`apps/server/src/entries/trust.ts` (new): one pure function that takes (kind, actor kind, scope
level, source, the replied-to question if any) and returns the initial status or a refusal
code, exactly as spec.md Interfaces → Trust rules, with its refusals in the order of step 9 of
spec.md Interfaces → Check order (`agent_cannot_write_rule`, `agent_cannot_answer`,
`agent_cannot_write_workspace`, `source_not_allowed`). A missing `source` is the actor's kind
(`human` or `agent`). A table
test covers every kind for a human and an agent, the workspace scope, the source rules and the
agent-answer rule (allowed only when the question's author is an agent and
`allow_agent_answers` is true).

`apps/server/src/entries/write.ts` (new): `createEntry(db, actor, input, now)` runs steps 6 to
11 of spec.md Interfaces → Check order, in that order: it resolves the scope (or, for an answer,
the `reply_to` entry and its scope, through `resolveScope`/`memberRole`, so a question in another
workspace, or a quarantined one asked about by an agent, is 404), refuses viewers (403
`role_cannot_write`), refuses an answer whose `reply_to` is not a question that is `open` or
`answered` (409 `invalid_state`), applies the trust function, runs `scanForSecrets` on title, body and refs (422 `secret_detected` with `rule`,
nothing stored, the value never echoed or logged), runs `detectInjection` on title and body and
treats `source: "web"` the same (status `quarantined`), stores the reason in
`quarantined_because` (`source-web` for a web source, else the id `detectInjection` returned),
sets `expires_at = now + 30 days` for claims, sets the author fields from the actor, and in one transaction inserts the entry, marks an
answered question `answered` (unless the answer is quarantined) and writes the audit
rows with `writeAudit` and `auditActor` (`entry.create` with `details: {kind, status}`, and
`entry.status` for the question; never a title, body or ref in `details`, spec.md Interfaces →
Audit log).
It returns the wire entry (`toWireEntry`), which carries `quarantined_because`. Keep it
reusable: the supersede and answer tickets call it.

`apps/server/src/entries/routes-write.ts` (new): `POST /api/v1/entries` → 201 `{entry}`;
`POST /api/v1/ask` → 201 `{entry, answers: []}` (`entry` is the question). Both go through the
rate limiter (`createRateLimiter`, keyed by `actorKey`, options from `createApp({ rateLimit })`,
default capacity 60 and refill 1 per second) before the request schema is checked (step 4 before step 5): over the limit → 429 `rate_limited` with
`Retry-After`. Export the limiter as route middleware from the entries folder so the later
write routes reuse it.

`apps/server/src/entries/router.ts` (new) combines the entries routes and is mounted once in
`createApp`; the later entries tickets add their routes to it, not to `app.ts`. Give
`createApp` its `rateLimit` option, and make `startTestServer` forward `rateLimit` (spec.md
Interfaces already lists it).

Tests (allowed and refused for every rule, CLAUDE.md): an agent's rule → 403
`agent_cannot_write_rule`; an agent's write to the workspace scope → 403
`agent_cannot_write_workspace`; a viewer and a viewer's agent → 403 `role_cannot_write`; an
agent's decision is `proposed`, a human's `approved`; a claim's `expires_at` is 30 days after the
injected clock; a body with an assembled GitHub token → 422 and no row; "Ignore previous
instructions…" → 201 `quarantined` with `entry.quarantined_because` `ignore-instructions`, from
post and from ask; `source: "web"` → `quarantined` with `source-web`; a clean entry's
`quarantined_because` is `null`; a body claiming `author: "mallory"`, `author_kind: "human"` and `status: "approved"` from an agent → stored with
the actor's ids, `proposed`; agent answers allowed and refused; an answer whose `reply_to` is a decision → 409
`invalid_state`; the check order: an agent's `rule` into the workspace scope → 403
`agent_cannot_write_rule`, an agent acting for a viewer posting a `rule` → 403
`role_cannot_write`, an agent's `rule` with an assembled API key → 403 `agent_cannot_write_rule`
and no scan; title of 201 characters and a 16,385-byte body → 413 with `field` `title` and
`body`, 51 refs → `refs`, and a fourth ref of 2,049 characters → `refs.3`; a third write with
`rateLimit {capacity: 2, refillPerSecond: 1}` → 429 with `Retry-After` while another actor still writes; a member of A
posting into B's project → 404 and no row in B; every successful write has its audit row with
the caller as actor.

Docs: `docs/DECISIONS.md` gains decisions (next free numbers) for the rate limit (per actor, in
memory, one instance, per token once auth lands), for how agents answer (the allow flag, and
the rejected "every agent question accepts agent answers"), and for the fixed 30-day claim
expiry (the user's decision; the per-workspace override PLAN section 6 promises is deferred).

## Not in this ticket

- `supersede`: the next ticket (06), which reuses `createEntry`.
- approve, reject, release and the `answer` route: the human routes ticket (07).
- Reading entries back over HTTP (get, search): a separate read ticket; tests here read rows
  through the harness database.
- A per-workspace claim expiry: not in this feature (spec.md Scope, the user's decision); every
  claim gets 30 days.

## Done when

- `pnpm --filter @sky-brain/server exec vitest run src/entries --reporter=verbose`
  passes, and the test names contain the
  `prints` lines of the check block below.
- A write with a secret leaves no entry and no audit row, and its response body does not contain
  the secret (asserted in a test).
- A member of one workspace cannot write into another (404, nothing stored), asserted in a test.
- All existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test` exits 0.

```check
# The conductor runs this block before review.
$ pnpm --filter @sky-brain/server exec vitest run src/entries --reporter=verbose
prints agent cannot write a rule
prints agent cannot write to the workspace scope
prints agent rule into the workspace scope is refused as a rule
prints viewer cannot write
prints author comes from the actor
prints refuses a body with an API key
prints quarantines ignore previous instructions
prints names the quarantine pattern in the entry
prints names the long ref by its index
prints rate limits a burst per actor
prints cannot write into another workspace
$ pnpm lint && pnpm typecheck && pnpm test
exit 0
```

## Reference

- spec.md § Interfaces (Routes, Check order, Trust rules, Audit log, Secret rules, Quarantine
  patterns, Wire types), § Stories (agent, person, poisoned or secret), § Edge cases
- docs/PLAN.md section 6 (read-only); docs/layer-1/TICKETS.md T4 (read-only)
- `apps/server/src/guards/`, `apps/server/src/scope/`, `apps/server/src/testing/harness.ts` (new in this plan)

## Answer
