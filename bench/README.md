# Benchmark (build plan step 0)

The numbers every later step reports against. Step 0 of
[BUILD-PLAN.md](../docs/vision/BUILD-PLAN.md) asks for plain word search to have baseline numbers
before any memory work starts.

## What is here

- `questions.jsonl`: 50 questions with known answers, taken from sky-brain's own history
  (DECISIONS.md, PLAN.md, CONNECT.md, ROADMAP.md, CLAUDE.md, BUILD-PLAN.md, MEMORY-SCHEMA.md,
  HUMAN-MEMORY.md). Each has a `type` (`why`, `what` or `status`), a short `answer`, and one or
  more `gold` sources: a file and a heading. A returned section counts as a hit when its file
  matches and its heading path contains the gold heading.
- `run.mjs`: the runner. It cuts every markdown file in `README.md`, `CLAUDE.md`, `docs/` and
  `plans/` into sections by heading (#, ##, ###; long sections are split at 1,500 characters),
  loads them into PGlite with an English `tsvector` (heading weight A, text weight B) and asks
  each question.
- `results/`: one JSON file per run, with the score of every question.

```
pnpm bench                        # run, print the table, write results/<label>.json
node bench/run.mjs --label foo    # name the results file
node bench/run.mjs --show q07     # top 5 sections for one question, gold marked *
```

No model is called and nothing touches the live database.

## Baseline: plain keyword search (23 Nov 2026)

Corpus: 75 files, 1,248 sections. Two modes of plain Postgres full-text search:

- `and`: every word of the question must match (`websearch_to_tsquery`).
- `or`: any word may match, ranked by `ts_rank_cd`.

| Mode | Recall@1 | Recall@3 | Recall@5 | Recall@10 | MRR | No result | p50 latency |
|---|---|---|---|---|---|---|---|
| and | 0.22 | 0.30 | 0.34 | 0.38 | 0.272 | 24 of 50 | 3 ms |
| or | 0.38 | 0.54 | 0.66 | 0.78 | 0.495 | 0 of 50 | 10 ms |

By type, Recall@5 with `or`: why 0.74 (19 questions), what 0.62 (29), status 0.50 (2).

What this says: the gold section is in the top 5 for two questions in three, but first for only
about one in three. About 1 question in 5 is missed entirely. Natural questions rarely share all
their words with the answer, so `and` finds nothing for half of them. The misses cluster on the
newest design (memory layers, vectors, sharing), where the 23 Nov review reports repeat the same
words as the schema and crowd it out.

## Limits, on purpose

- **Retrieval only.** This measures whether the right section is found, not whether an agent
  answers correctly. The answer-quality runs (task success, decisions kept, tokens) need the
  agent loop from step 2 and come at the step 3 measure gate.
- **50 questions, not 100 or 300.** Enough to set a baseline; too few to show a small gain from
  one signal. Grow to at least 300 before step 5 (R4-18 in the schema review).
- **Our own history.** The questions come from documents the team wrote, so they risk teaching
  to the test. Add questions from Pathly (an unseen project) before the measure gate.
- **Gold labels are strict.** Six questions also accept a second section found to hold the same
  answer (a review report). Other correct sections may still count as misses.

## Next

Step 1's `search` tool runs the same questions over entries in the brain, and reports its
numbers next to this table.
