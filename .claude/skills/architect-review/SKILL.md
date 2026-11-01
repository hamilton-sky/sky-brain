---
name: architect-review
description: Enterprise architecture review — evaluate a module, feature, or PR diff against production-grade standards. Covers resilience, observability, data contracts, scalability, and security. Returns a prioritized findings report with severity ratings.
argument-hint: "[file-path | feature-name | 'staged' | 'last-commit']"
---

Perform an enterprise-grade architecture review of `$ARGUMENTS`.

## Step 0: Gather the target

- If `$ARGUMENTS` is `staged` → run `git diff --staged`
- If `$ARGUMENTS` is `last-commit` → run `git diff HEAD~1 HEAD`
- If `$ARGUMENTS` is a file path → read the file
- If `$ARGUMENTS` is a feature name → search `plans/$ARGUMENTS/` (or the project's ticket folder) and the relevant source directories
- If `$ARGUMENTS` is empty → review `git diff --staged`

Read all relevant files before forming any judgements. For backend code, also read the module file and any dependent service interfaces.

---

## Step 1: Structural Architecture Review

### Module Boundaries
- [ ] **Single Responsibility**: Does each class/module own exactly one domain concern?
- [ ] **Interface Segregation**: Are interfaces narrow (consumers depend only on what they use)?
- [ ] **Dependency Direction**: Do dependencies flow inward (domain ← application ← infrastructure)?
- [ ] **Circular Dependencies**: Any imports that cycle back to the same module?
- [ ] **Module Encapsulation**: Is the public surface (exports, registered providers) deliberate, with internals kept private?

### Data Contracts
- [ ] **Typed boundaries**: All external inputs (WS messages, HTTP bodies, API responses) validated with typed guards?
- [ ] **Discriminated unions**: Event/message types use union types, not string comparisons?
- [ ] **No `any`**: Every `any` is a contract hole — flag each one with its severity
- [ ] **Shared types**: Cross-boundary types live in one shared definition, not duplicated per side?
- [ ] **Immutability**: Config objects and props marked `readonly`?

---

## Step 2: Resilience & Fault Tolerance Review

For each async operation or external call found in the code:

- [ ] **Timeout**: Is there a timeout guard? Unbounded awaits are production incidents.
- [ ] **Retry**: Is retry implemented with exponential backoff + jitter for transient failures?
- [ ] **Circuit Breaker**: Is there a circuit breaker to stop cascading failure under sustained errors?
- [ ] **Idempotency**: Can this operation safely run twice without side effects?
- [ ] **Dead Letter / Fallback**: What happens when the operation permanently fails?
- [ ] **Graceful Degradation**: Does the system continue operating (degraded) when this service is unavailable?
- [ ] **Bulkhead Isolation**: Can failure in this path impact unrelated request paths?

---

## Step 3: Observability Review

- [ ] **Structured logging**: All log calls use the project's structured logger with metadata, no bare `console.log` / `print`
- [ ] **Correlation IDs**: Are request/session IDs propagated through async boundaries?
- [ ] **Error context**: Caught errors logged with `{ error, stack, context }` — not just `err.message`
- [ ] **Operation timing**: Are slow paths (AI calls, DB queries, external APIs) measured?
- [ ] **Failure visibility**: Are error conditions logged at `error` level, warnings at `warn`?
- [ ] **OpenTelemetry**: Are spans created for significant operations? Is trace context propagated?

---

## Step 4: Performance & Scalability Review

- [ ] **Blocking operations**: Any sync-heavy work on the event loop that should be offloaded?
- [ ] **N+1 queries**: Any DB or cache access inside a loop?
- [ ] **Caching opportunity**: Is expensive, repeated computation cached (Redis or in-memory with TTL)?
- [ ] **Queue offload**: Should long-running work be pushed to a background job queue instead of awaited inline?
- [ ] **Memory leaks**: Event listeners, intervals, and subscriptions cleaned up properly?
- [ ] **Pagination**: Are unbounded list queries guarded with limits?

---

## Step 5: Security Review

- [ ] **Input validation**: All external inputs sanitized before use?
- [ ] **Injection risk**: Any user data concatenated into queries, shell commands, or log messages?
- [ ] **Auth guards**: Are protected routes/WS handlers gated with auth checks?
- [ ] **Secret exposure**: No secrets, API keys, or PII in logs or error responses?
- [ ] **Human-in-the-loop**: Destructive or irreversible operations require explicit user approval?
- [ ] **Rate limiting**: Are high-frequency endpoints or WS message types rate-limited?

---

## Step 6: Testability Review

- [ ] **Dependency injection**: Are dependencies injected (not instantiated inline) so they can be mocked?
- [ ] **Pure functions**: Are complex transformations extracted as pure, easily-testable functions?
- [ ] **Test surface**: Is there a test in the project's test directory covering the primary paths?
- [ ] **Edge cases in tests**: Are error paths (timeout, null input, unavailable service) tested?

---

## Step 7: Project Convention Violations

Read `CLAUDE.md`, `AGENTS.md`, and any contributing or style docs in the repo. For each explicit rule or "forbidden" item they list, check whether the target violates it, and add each violation to the findings table with the rule it breaks. If the repo documents no conventions, mark this category ✅ PASS.

---

## Step 8: Produce the Report

Output a prioritized findings report:

```
## Architecture Review: [target]

### Summary
[1-3 sentence overall assessment: is this production-ready, needs hardening, or has blockers?]

### Severity Legend
🔴 BLOCKER — Must fix before merge. Production incident risk or contract breakage.
🟠 HIGH    — Fix in this PR or immediately after. Degrades reliability or observability.
🟡 MEDIUM  — Fix in next iteration. Code smell or missing best practice.
🟢 LOW     — Nice to have. Minor improvement.
✅ PASS    — No issues found in this category.

---

### Findings

| # | Severity | Category | Location | Issue | Recommendation |
|---|----------|----------|----------|-------|----------------|
| 1 | 🔴 | Resilience | `ServiceName.method()` | No timeout on upstream API call | Wrap with `Promise.race([call, timeout(10_000)])` |
| 2 | 🟠 | Observability | `handler.ts:42` | Error caught but not logged with context | `logger.error('Failed to process', { error: e.message, sessionId })` |
...

---

### Categories with No Issues
✅ Data Contracts — all types narrow and properly guarded
✅ Security — inputs validated, auth guards present
...

---

### Recommended Next Actions
1. [Highest priority fix — one sentence]
2. [Second priority fix]
3. [Optional improvement]
```

If there are zero findings in a category, mark it ✅ PASS — do not pad the report with empty sections.
