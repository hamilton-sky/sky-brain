# Outside review: architecture, vision and product (14 Nov 2026)

An outside review of the repository's vision, [BUILD-PLAN.md](BUILD-PLAN.md), DECISIONS, ROADMAP and
PLAN, kept as received. It reviews the documents, not the code: the reviewer did not audit files or
run tests. Two earlier reviews from the same day were folded into BUILD-PLAN.md and removed; they
are in git history.

---

## Sky-Brain — Architecture, Vision & Product Review

My initial assessment is that Sky-Brain has a promising architectural direction, particularly as a shared memory and coordination system for multiple AI agents.

The most interesting part is not its attempt to borrow ideas from human cognitive psychology. It is the combination of persistent memory, knowledge provenance, human authority, shared tasks, and decision history.

That combination addresses a real problem: AI agents can be capable within a session but often lose important context, repeat mistakes, contradict previous decisions, or fail to coordinate across tools.

However, I would distinguish three questions:

- Is the vision technically credible? Yes, with important qualifications.
- Is the proposed architecture better than conventional RAG or agent-memory systems? Potentially, but it needs experimental evidence.
- Is this already a mature implementation? No. The repository itself describes much of the cognitive architecture as proposed work rather than implemented functionality.

The key question is whether Sky-Brain can become a system that improves an agent's decisions over time, rather than simply storing more information.

### 1. Architecture: what I like most

Sky-Brain's intended architecture, top to bottom:

1. **People and AI agents:** Claude · Codex · Pathly · Web app
2. **MCP / REST API:** Identity · Permissions · Gatekeeper
3. **Shared Board** (goals, tasks, claims, questions) · **Memory** (episodes, facts, decisions, lessons) · **Retrieval** (search, context, links) · **Consolidation** (digest, review, summaries)
4. **PostgreSQL, single source of truth:** versioned records · provenance · relationships · audit

Conceptual architecture from the project documentation, not a diagram of fully implemented components.

The strongest design decisions are:

- Postgres as the authoritative store: sensible for transactional consistency, permissions and versioning.
- Human-approved decisions: agents should not silently convert their own guesses into organizational truth.
- Append-only history: useful for reconstructing why an agent acted on an earlier decision.
- Task-aware context: returning relevant decisions when an agent claims a task is much more useful than indiscriminate memory retrieval.
- Separating execution from memory: keeping agents and their code execution outside Sky-Brain reduces the system's responsibilities and security exposure.

The architectural direction is coherent.

### 2. Cognitive psychology: does it actually add value?

I particularly like that the November 14 build plan makes cognitive mechanisms optional ranking signals rather than introducing a large subsystem for every psychological concept.

| Mechanism | Potential benefit | Main risk |
| --- | --- | --- |
| Attention | Less irrelevant context | Missing critical evidence |
| Episodic memory | Reconstructing what happened | Growing storage and noise |
| Consolidation | Turning experience into useful lessons | Reinforcing incorrect conclusions |
| Associative recall | Finding causal relationships | Invented or weak links |
| Activation and forgetting | Prioritizing useful information | Hiding old but binding decisions |
| Metacognition | Recognizing uncertainty and contradictions | False confidence in uncertainty detection |

The proposed metacognition feature is especially valuable.

Imagine an agent receives a task to migrate an application from one database to another. Instead of retrieving an outdated architecture note and proceeding, Sky-Brain could return:

> The previous database decision is still approved, but newer technical evidence contradicts one of its assumptions. No replacement decision has been approved.

That is a meaningful improvement over basic similarity search.

However, these mechanisms are still engineered approximations. Sky-Brain is not demonstrating human cognition or autonomous human-like understanding. Its value must be measured by whether these mechanisms help agents complete tasks more reliably.

### 3. The biggest architectural concerns

#### A. The trust model is too rigid in one place

The new plan says that only humans can promote information into verified facts or approved decisions.

I agree for decisions, policies and other authoritative rules.

But for facts, I would distinguish between a verified observation and an approved organizational truth.

For example, an automated test can verify that a particular API endpoint returns a specified status at a particular commit. Requiring a person to approve every such observation could create a huge review queue.

I would introduce an evidence-backed observation type that agents can create, without granting them permission to establish binding decisions.

#### B. Memory versioning needs more precise semantics

Append-only `item_versions` is a good foundation, but it does not automatically solve:

- Concurrent writes from multiple agents.
- Facts that were valid only during a specific time period.
- Decisions that apply to different projects or environments.
- Conflicts between a historical decision and a new observation.
- Deletion requests across derived summaries and embeddings.

I would use both valid time (when something was true) and recorded time (when the system learned it), at least for decisions and important facts.

#### C. Consolidation could become the most dangerous cognitive feature

The proposed Consolidator merges duplicates, proposes lessons, detects contradictions and updates summaries.

This is useful, but it can also amplify errors.

If one agent makes a mistaken inference and three later agents repeat it, the system must not treat that repetition as independent confirmation.

The build plan explicitly recognizes this. I would go further and track evidence lineage so that several claims derived from the same original source are counted as one source, not several.

#### D. The context packet may be too restrictive

The proposed packet contains four or five summarized chunks.

That is a good default, but not every task has the same context requirements.

A code refactoring task may require architecture decisions, interfaces, tests, previous failures and current task dependencies.

I would make the context budget adaptive, with an explicit way for the agent to retrieve more evidence. The objective should be minimum sufficient context, not a fixed number of chunks.

#### E. The plans need consolidation

I found a documentation inconsistency worth resolving before implementation continues.

The older roadmap includes Pages, Views, Templates and live collaboration as major product layers. The newer cognitive build plan explicitly postpones much of that work.

Similarly, the older `PLAN.md` describes one memory-entry model, while `BUILD-PLAN.md` proposes a more specialized structure involving `episodes`, `item_versions`, `links` and knowledge kinds.

The latest build plan says these choices are not yet recorded as approved decisions. That is good transparency, but it means the repository currently contains multiple architectural generations.

I would resolve the data model and scope differences before writing migrations.

### 4. Comparison with other approaches

This is my architectural assessment, not a measured benchmark.

| Approach | Best at | Where Sky-Brain could win |
| --- | --- | --- |
| Conventional RAG | Simple document retrieval | Persistent decisions and coordination |
| Long-context agents | Reasoning over large inputs | Cross-session continuity |
| Mem0 | Capturing and retrieving memories | Shared authority and task lifecycle |
| Letta / MemGPT | Agent memory management | Cross-agent governance |
| Zep / Graphiti | Temporal and relational memory | Combining memory with a shared task board |
| Sky-Brain | Intended integrated memory and coordination | Still needs to demonstrate the advantage |

I would not claim that Sky-Brain is categorically better than these alternatives. Several have more mature implementations and sophisticated memory mechanisms.

Its potential differentiation is not superior vector search. It is making knowledge actionable, traceable and consistent across multiple agents.

### 5. My assessment of the build plan

I agree with the overall order, especially starting with a benchmark rather than implementing every cognitive mechanism immediately.

I would make one adjustment: introduce a minimal end-to-end workflow before spending significant time optimizing retrieval.

- **Phase 1 — Reliable memory:** typed entries, provenance, versioning, permission enforcement and basic search.
- **Phase 2 — Complete agent workflow:** agent claims task → retrieves context → completes work → records evidence → proposes lesson.
- **Phase 3 — Measure the improvement:** compare task outcomes against basic retrieval and hierarchical memory.
- **Phase 4 — Add cognitive mechanisms:** introduce attention, activation, consolidation and associative retrieval individually, keeping only improvements supported by measurements.

One methodological improvement: the proposed benchmark should include unseen projects, not only questions drawn from Sky-Brain's own history. Otherwise it risks being optimized for its own data.

I would also measure the number of human approvals required, the frequency of stale or incorrectly promoted information, and how often agents must ask for additional context.

### 6. Implementation status and confidence

The repository README describes an offline core under development, with PGlite tests, a deployed Vercel API and a task board. It also says authentication is not yet integrated and the deployed API refuses requests requiring an authenticated actor.

I inspected the main vision, consolidated build plan, architecture decisions, roadmap, product plan and the cognitive review. I have not completed a file-by-file audit of the entire implementation or executed its tests, so I would not yet give a definitive code-quality or production-readiness rating.

Here is my provisional assessment of the design itself:

| Area | Score |
| --- | --- |
| Vision and problem selection | 9/10 |
| Architectural coherence | 8/10 |
| Cognitive design | 8/10 |
| Security and trust design | 8/10 |
| Scope and implementation focus | 6/10 |
| Demonstrated performance advantage | 2/10 |

Subjective design scores, not empirical results or verified implementation ratings.

### 7. Is it worth building?

Yes. I think the project is worth pursuing, but as a focused developer infrastructure product first.

The strongest use case is a team using multiple AI coding agents across different machines, sessions and tools, where decisions and task state must remain consistent.

The weaker initial positioning would be a general-purpose digital human brain for everyone. That introduces too many requirements before the core benefit has been demonstrated.

I also think the relationship with Pathly is valuable. Pathly can execute development workflows while Sky-Brain provides shared context and durable knowledge. That gives you a concrete environment in which to test the product rather than relying on artificial demos.

The single most important experiment I would run is this:

> Give two groups of identical agents a multi-week software project. One group uses ordinary memory retrieval; the other uses Sky-Brain. Measure which group completes more work correctly, repeats fewer mistakes, and preserves decisions with less human intervention.

If Sky-Brain wins that experiment convincingly, the cognitive architecture has earned its complexity.

My recommended next step is a code-level architecture audit of `apps/server`, `api`, `packages/shared`, database migrations, MCP endpoints and tests, followed by a gap analysis against `BUILD-PLAN.md`. That would establish exactly what is implemented, what is only documented, and what should change before the next development phase.
