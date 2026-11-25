# Shared brief: memory schemas for sky-brain (red/blue team review, 23 Nov 2026)

## The product
sky-brain (repo at /home/user/sky-brain, read-only for you) is a personal "digital self" brain for people and their AI agents.
Postgres (Nanogres, managed, pgvector 0.8.1 with halfvec + HNSW enabled) is the source of truth. Express server on Vercel serverless,
MCP connector for agents (Claude, Codex). Sign-in via Perminister, limited to an email allowlist. sky-brain never calls an LLM itself,
except server-side embeddings. Agents run in the person's own model and pull work over MCP.

Read before you design or attack (skim, do not dump):
- /home/user/sky-brain/CLAUDE.md (hard rules: agents cannot approve; every query filtered by membership; quarantine; secret scan; fenced context packet)
- /home/user/sky-brain/docs/vision/BUILD-PLAN.md (ordered build plan, rules D21/D22: kind + trust level, append-only versions, nothing edited in place)
- /home/user/sky-brain/docs/vision/REVIEW.md (outside review: valid time vs recorded time, evidence lineage, adaptive context)
- /home/user/sky-brain/docs/vision/VISION.md (sections "The brain model", "Self-made links", "Growth", "What brain science changes")
- /home/user/sky-brain/docs/PLAN.md sections 4-6 (scopes, current data model, trust rules)
- /home/user/sky-brain/apps/server/drizzle/*.sql (actual tables today: workspaces, members, invites, projects, features, entries, audit_log, goals, tasks, task_deps, task_events, devices, run_tokens)
- /home/user/sky-brain/docs/DECISIONS.md (decision log)

## The four memory levels
- **Core memory**: exactly ONE per person. Identity, stable preferences, values, "about me", standing rules. (The user wrote "code memory"; it means core.)
- **Long-term memory**: many per person. Durable consolidated knowledge: facts, decisions, lessons, people, topics. Could be per life area / project.
- **Short-term memory**: many per person. Recent captures, inbox, episodes, conversation notes; fades unless used or consolidated.
- **Working memory**: many per person. The blackboard: the active task board (goals/tasks that exist today) plus the scratch context agents share while doing a piece of work.

## Requirements from the owner (shammai), verbatim intent
1. The embedding vector must NOT be of the full body (bodies can be long markdown). Vector = of a summary (or chunks). Keyword (full-text) search stays on the body.
2. A single person has exactly one core memory, and can create many working, short and long memories.
3. The owner can invite other users to different parts of the brain (a specific memory, or a layer) so they can collaborate. Permissions are per memory.
4. All of it belongs to one user, who invites others to parts.
5. Fold in human memory psychology: how best to retrieve memory and how to preserve it (cue-dependent retrieval, spreading activation, spacing, consolidation, reconsolidation, forgetting curve, schemas, episodic vs semantic).

## Starting sketch (from the coordinator; a starting point only, not the code in the repo)
```sql
CREATE TABLE entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  layer text NOT NULL CHECK (layer IN ('working','short','long')),
  kind text NOT NULL CHECK (kind IN ('fact','decision','hypothesis','external')),
  type text, title text, body text NOT NULL,
  source text NOT NULL, written_by text NOT NULL, confidence real DEFAULT 1.0,
  last_used timestamptz DEFAULT now(), use_count int DEFAULT 0, expires_at timestamptz,
  embedding halfvec(1536),
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || body)) STORED,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE entry_links (from_id uuid REFERENCES entries(id) ON DELETE CASCADE, to_id uuid REFERENCES entries(id) ON DELETE CASCADE,
  relation text NOT NULL, weight real DEFAULT 1.0, PRIMARY KEY (from_id, to_id, relation));
CREATE INDEX ON entries USING hnsw (embedding halfvec_cosine_ops);
CREATE INDEX ON entries USING gin (search);
CREATE INDEX ON entries (owner_id, layer, last_used DESC);
```
Known issues with the sketch the owner already raised: embedding is of the body; no notion of a "memory" container; no core layer; no sharing.

## Output rules
- Write your full result as markdown to the output file named in your prompt (under the scratchpad dir given there). Keep it under ~900 lines.
- Your final message back should be a ~250-word summary of your main points and the file path.
- Do not modify the repo. Do not push. Do not use the network except web search if your role says so.
- Plain, concrete language. Real Postgres 16+ SQL where you propose schema. Use English-agnostic search where relevant (owner writes Hebrew and English).

## Owner decision added 23 Nov 13:00
The agent writing an entry also writes its `summary` (required on agent writes; Gatekeeper checks length/quality). The server embeds the summary. Fallback for entries without one (person typing in the web UI): embed title + first chunk, flagged for the Consolidator to re-summarize. Each summary belongs to one entry version and records its author; the Consolidator re-summarizes stale ones.
