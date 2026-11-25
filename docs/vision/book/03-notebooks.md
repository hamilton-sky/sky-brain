# 3. Layer: Notebooks

## What it is for

Notebooks hold what lasts: facts that stay true, decisions with their reasons, lessons the person
kept. They are the brain's **long-term memory**. A person can have many (Work, Family, Health), each
shared or private on its own.

## What is in it

Entries the person approved, plus proposals waiting for them. Each entry has a `kind` (fact,
decision, hypothesis, observation, external), a summary, the questions it answers, its sources, and
every earlier version. Nothing is edited in place: a change is a new version.

## How to use it

- **Search, then get.** `search` returns summaries, not bodies; `get` the one or two you need.
- **Narrow when you can:** `kind: "decision"` for "what did we decide", `memory_id` for one Notebook.
- **Approved is truth, proposed is a guess.** Say so when you rely on a proposed entry.
- **When entries disagree,** prefer approved, then newer, and tell the person.
- **You never write here directly.** You capture into the Inbox; the person keeps it into a
  Notebook (or you ask with `request_approval`).

## Its APIs (generated)

- **list_memories** · read-only → every memory with id, name and layer; pick a Notebook's id.
- **search** · read-only · `q`; `layer: "long"`, `memory_id?`, `kind?`, `limit?` (≤50) →
  ranked summaries.
- **get** · read-only · `entry_id` → full body and version history.

## Recipe: "what did we decide about X?"

1. `search { q: "X", kind: "decision" }` (or `layer: "long"`)
2. If empty: `search` again with a synonym, without `kind`.
3. `get` the best approved match; answer with its date and status.
