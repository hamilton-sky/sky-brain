---
name: automation-design
description: Design an enterprise-grade automation pipeline or workflow system. Takes a plain-language description of what needs to be automated and produces a full technical blueprint: pipeline stages, fault-tolerance model, state machine, data contracts, observability plan, and a phased implementation plan that the feature-flow skill can turn into tickets.
argument-hint: "[plain-language description of the automation, e.g., 'auto-retry failed jobs with backoff', 'nightly batch import pipeline', 'resume interrupted uploads']"
---

Design an enterprise automation system for: **$ARGUMENTS**

You are a world-class automation architect. You design systems that are **reliable at scale**, **observable in production**, and **maintainable by a team**. Every automation you design has a clear failure model, not just a happy path.

---

## Step 1: Clarify the Automation Scope

Before designing, establish:

1. **Trigger**: What starts the automation? (user action, schedule, event, webhook, threshold breach)
2. **Input**: What data does it receive? What is the expected shape and validation requirements?
3. **Output / Side Effect**: What does it produce or change? (DB write, API call, UI update, message sent)
4. **Frequency & Volume**: How often? How many concurrent instances? What's the peak load?
5. **Latency Requirement**: Is this real-time (<100ms), near-real-time (<2s), or batch (minutes)?
6. **Failure Tolerance**: What's acceptable? (retry silently, alert user, block, compensate?)
7. **Statefulness**: Does it need to resume after interruption, or restart from scratch?

If the user already provided enough context, skip the interview and proceed to Step 2.

---

## Step 2: Research Existing Patterns

Before proposing anything new, read the codebase:

1. **Existing pipeline code** — workers, job processors, schedulers, event handlers
2. **Existing workflow patterns** — similar automations already in the repo, and existing `plans/` folders
3. **Shared types** — existing message/event/contract types the automation should reuse
4. **Job queue usage** — how existing jobs are defined, retried, and monitored
5. **Trigger and message flow** — existing gateways, controllers, or event buses the automation could plug into

Identify: what can be reused, what needs extending, what must be built from scratch.

---

## Step 3: Design the Automation Blueprint

### 3a. Pipeline Stage Diagram

Model the automation as a sequence of named, isolated stages:

```
[Trigger / Input]
      │
      ▼
┌─────────────────────────────────────────────┐
│  Stage 1: INPUT VALIDATION                  │
│  • Validate schema (throw on invalid)        │
│  • Normalize / enrich input                  │
│  • Emit: validation.passed / failed metric   │
└─────────────────────────────────────────────┘
      │ valid input
      ▼
┌─────────────────────────────────────────────┐
│  Stage 2: [DOMAIN PROCESSING STAGE NAME]    │
│  • [Core business logic]                     │
│  • Side effect: [DB write / API call / etc.] │
│  • Retry: [yes/no — strategy]               │
└─────────────────────────────────────────────┘
      │
      ├─── success ──► [Stage 3 or Output]
      │
      └─── failure ──► [Error Handler / DLQ]
```

Rules for pipeline design:
- Each stage is a **single responsibility** — one input, one output, one error path
- Stages communicate via **typed events or return values**, never shared mutable state
- Each stage logs entry, exit, and duration
- Each stage that calls an external system has a **timeout + fallback**

### 3b. State Machine (if stateful)

If the automation has multiple states (e.g., a multi-step workflow), define the state machine:

```
States:     PENDING → RUNNING → [COMPLETED | FAILED | RETRYING | CANCELLED]

Transitions:
  PENDING   + trigger      → RUNNING     (persist state, start processing)
  RUNNING   + success      → COMPLETED   (persist result, emit event)
  RUNNING   + retryable    → RETRYING    (increment attempt, schedule next)
  RUNNING   + fatal-error  → FAILED      (persist error, alert, DLQ)
  RETRYING  + max-attempts → FAILED
  *         + cancel       → CANCELLED   (compensate if needed)
```

### 3c. Fault Tolerance Model

For each external call or async operation in the pipeline:

| Operation | Timeout | Retry Strategy | Max Attempts | Circuit Breaker | Fallback |
|-----------|---------|----------------|--------------|-----------------|---------|
| [op name] | [ms] | [exp backoff + jitter] | [N] | [yes/no] | [what happens] |

**Retry formula**: `delay = min(baseDelay * 2^attempt + jitter(0..500ms), maxDelay)`

### 3d. Data Contracts

Define all types at the pipeline boundary:

```typescript
// Input contract
interface AutomationInput {
  readonly id: string;           // correlation ID for tracing
  readonly triggeredBy: string;  // user ID or system
  readonly payload: [specific type];
  readonly metadata: {
    readonly sessionId: string;
    readonly timestamp: number;
  };
}

// Output / result contract
type AutomationResult =
  | { readonly status: 'completed'; readonly output: [type]; readonly duration: number }
  | { readonly status: 'failed';    readonly error: string;  readonly attempt: number }
  | { readonly status: 'partial';   readonly completed: [type][]; readonly failed: [type][] };

// Event emitted to consumers
interface AutomationEvent {
  readonly type: 'automation.completed' | 'automation.failed' | 'automation.step';
  readonly automationId: string;
  readonly payload: AutomationResult;
}
```

### 3e. Observability Plan

Every automation must be observable. Define:

```
Logs (structured):
  INFO  — stage start/end with duration
  WARN  — retryable failure (attempt N of M)
  ERROR — fatal failure with full context { error, stack, input.id, stage }

Metrics (OpenTelemetry or the project's metrics library):
  automation.[name].duration     — histogram
  automation.[name].success      — counter
  automation.[name].failure      — counter (tagged by stage + error type)
  automation.[name].retry        — counter
  automation.[name].queue.depth  — gauge (if queue-based)

Traces:
  Root span: automation.[name]
  Child spans: one per stage
  Attributes: correlation ID, input size, output size, attempt count
```

### 3f. Job Queue Configuration (if async/background)

Express these settings in whatever queue library the project already uses:

```typescript
// Job definition
interface [AutomationName]Job {
  data: AutomationInput;
  opts: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,  // keep last 100 completed
    removeOnFail: 500,      // keep last 500 failed for debugging
    timeout: 30_000,        // kill job after 30s
  };
}
```

---

## Step 4: Integration Points

Map how this automation fits into the project's existing architecture:

```
[Where it plugs in]
  ├── Message trigger → existing gateway/handler → new message type: [name]
  ├── OR HTTP trigger → new endpoint on an existing service
  ├── OR Scheduled → queue or scheduler cron job
  └── OR Event-driven → subscribes to existing [EventName] event

[Output goes to]
  ├── Stream back to the client (real-time progress)
  ├── OR DB persistence (entity/table: [name])
  ├── OR Cache (TTL: [value])
  └── OR triggers downstream automation: [name]
```

---

## Step 5: Implementation Plan

Produce a phased plan. Each phase should be small enough to become one ticket:

### Phase 1: Types & Contracts
- Define all input/output/event types where the project keeps shared types
- No implementation — types only
- Verify: `[the project's build or typecheck command]`

### Phase 2: Core Pipeline Service
- Create the service in the project's usual location for the domain, named after the automation
- Implement pipeline stages as private methods
- Inject dependencies (optional services gracefully degrade)
- Include full fault tolerance (retry, timeout, circuit breaker)
- Verify: `[the project's build command]`

### Phase 3: Queue / Trigger Integration
- Register the queue processor if async
- Wire into the chosen trigger: gateway, endpoint, scheduler or event subscription
- Add routing for the new message type or route
- Verify: `[the project's build command]`

### Phase 4: Tests
- Unit tests for each pipeline stage in isolation
- Integration test for the happy path
- Error path tests (timeout, retry exhaustion, invalid input)
- Verify: `[the project's test command]`

### Phase 5: Client / UI Integration (only if the automation has a user-facing surface)
- Add client state for tracking automation status
- Wire event listeners for progress streaming
- UI: progress indicator + error state
- Verify: `[the client build and test command]`

---

## Step 6: Create Strategy Folder

Ask the user: "Should I turn this design into a plan at `plans/[automation-name]/` (a spec, a map and a graph of tickets)?"

If yes → plan it with the feature-flow skill (`/feature-flow [automation-name]` in Claude Code, `$feature-flow [automation-name]` in Codex), using this blueprint as the specification.

---

## Step 7: Output the Blueprint

```
## Automation Blueprint: [Name]

### What it does
[2-3 sentences: trigger → processing → output]

### Architecture Pattern
[Pipeline / State Machine / Event-Driven / Scheduled Batch]

### Pipeline Stages
[diagram from Step 3a]

### Fault Tolerance Summary
[table from Step 3c]

### Key Data Types
[contracts from Step 3d]

### Integration Point
[where it plugs in to the existing architecture]

### Implementation Phases
[phases from Step 5 — with file paths and verify commands]

### Risks & Mitigations
- [Risk 1]: [Mitigation]
- [Risk 2]: [Mitigation]

### Open Questions
- [Any decisions that need user input before implementation]
```
