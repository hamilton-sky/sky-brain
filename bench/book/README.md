# Brain book bench (BOOK.md section 10, build step 0)

Does the brain book help models use sky-brain? This bench measures it before any of it ships.
It runs a Claude model against sky-brain's **real MCP server**, in process, on a fresh in-memory
test brain per trial, and grades each task by what ends up in the database and in the answer.

Nothing here changes what the live server shows a model. Arms B and C exist only in the bench,
so the two-week memory-loop measurement is not disturbed.

## The arms

| Arm | What the model sees |
| --- | --- |
| A | Today's 18 tools, exactly as `tools/list` returns them |
| B | The same tools, with "Use when" and "Pitfalls" added to each description (`arms.ts`) |
| C | B, plus server instructions (347 characters) and one read-only tool `book { id? }` that serves the chapters in `docs/vision/book/` with a live "Your brain now" block (`book.ts`) |

The decisive comparison is **C against B on the held-out tasks**. If C does not beat B, ship B
only and keep the chapters as the source of the descriptions.

## The tasks

34 tasks (`tasks-memory.ts`, `tasks-board.ts`, `tasks-approval.ts`), each with a scope:

| Scope | Tasks | Examples |
| --- | --- | --- |
| About me | 3 | units preference, coffee (approved fact against a proposed Inbox note), "put this in About me" |
| Notebooks | 5 | a reason only in the body, the old belief in the version history, one named Notebook |
| Inbox | 6 | captures of each kind, web text, an injected instruction, proposed vs approved |
| Across layers | 3 | "everything about the stack", an observation with refs, using About me before acting |
| Board | 12 | projects, next task, done, release vs failed, plan a goal, add a dependent task, attach a document |
| Approval | 5 | "approve this for me", "delete that", ask for approval, check a request, propose a rule |

12 tasks are **held out** (fixed by id in `tasks.ts`): don't read them while writing arm B's
descriptions or the book. The test brain (`seed.ts`) is one person, Ann, with entries in every
layer, a second Notebook, a two-version entry, a conflict between layers, a project with an
approved goal (one task ready, one waiting on it) and a draft goal, and one pending approval
request.

Every task has a known-good **gold** run. `--dry` checks that each grader passes its gold run and
fails an empty one, with no model.

## Running it

```
pnpm bench:book --dry           # 34 of 34 graders pass gold and fail empty; no model, no key
pnpm bench:book --tokens        # size of each arm's tool definitions (counted by the API with a key)
ANTHROPIC_API_KEY=... pnpm bench:book --models claude-opus-5-5,claude-haiku-5-5 --trials 3
```

Without an API key, run it through Claude Code with your own sign-in:

```
pnpm bench:book --via claude-code --models sonnet --trials 1    # 3 arms x 34 tasks = 102 runs
```

Each trial serves the arm's tools from a small MCP endpoint on localhost and runs `claude -p` from
an empty folder with no built-in tools, so the brain's tools are all it has. Arm C's server
instructions arrive the way a real client gets them, in `initialize`. Your own
`~/.claude/CLAUDE.md`, if you have one, still loads. Token counts are Claude Code's, which
include its own system prompt.

Six complex scenarios (`tasks-complex.ts`, several tools across layers in order) were written
after the first run and count as held out. Run them with `--set complex` (`--set all` for every
task).

Options: `--arms A,B,C`, `--split tune|held|all`, `--tasks id1,id2`, `--concurrency 4`,
`--label name`, `--base-url` (default `https://api.anthropic.com`). Each trial seeds its own
PGlite, so a full run takes a while; results go to `results/<label>.json` with every trial's
calls, answer, verdict and token use.

## What is reported

Per model and arm: pass^1 and pass^k on the held-out and tuning tasks, pass^1 by scope, and per
trial on average: wrong-tool calls (an unknown tool, or a write tool the gold run did not need),
invalid arguments, extra calls beyond the gold run, book calls, and tokens in and out (the book's
own cost included). A trial gets 12 model turns at most.

## Sizes today (25 Nov 2026, estimated at 3.5 characters a token)

| Arm | Tools | Characters | About |
| --- | --- | --- | --- |
| A | 18 | 17,796 | 5,100 tokens |
| B | 18 | 20,698 | 5,900 tokens |
| C | 19 | 21,573 | 6,200 tokens, plus about 800 for the book's contents when opened |

Well under the 10K-token trigger for compact mode (BOOK.md section 11).

## First run: Sonnet through Claude Code (25 Nov 2026)

`--via claude-code --models sonnet --trials 1`: 102 runs, about $2.71, no run cut off.

| Arm | pass^1 held (12) | pass^1 tune (22) | pass^1 all | extra calls | book calls | tokens in / out |
| --- | --- | --- | --- | --- | --- | --- |
| A | 100% | 86% | 91% | 0.94 | 0 | 40,188 / 410 |
| B | 100% | 100% | 100% | 0.82 | 0 | 42,437 / 379 |
| C | 92% | 100% | 97% | 0.97 | 0.06 | 45,656 / 405 |

Failures: A failed `capture-about-me` (its capture returned an error and it saved nothing),
`approve-trap` (it asked for approval but then said the goal was approved) and `delete-trap` (it
never said it cannot delete). C failed `across-before-work` (the recipe came out in imperial units).
B failed nothing.

Reading: A's three failures are exactly the traps that B's pitfalls name, but they are tuning
tasks, which the descriptions were written against. On the held-out tasks A and B tie and C is one
task lower, and C's model opened the book in only 6% of runs. With one trial per task, a
one-task gap is noise. By section 10's rule (C must beat B on the held-out tasks), the book does
not earn its place yet: ship B's descriptions after the measurement window, and keep the chapters
as their source.

## Complex scenarios: Haiku, Sonnet, Opus (25 Nov 2026)

`--via claude-code --set complex`. 144 runs, about $5.24 in total.

| Model | Trials | A | B | C | Book calls per run (C) |
| --- | --- | --- | --- | --- | --- |
| Haiku | 4 | 75% | 71% | 75% | 0.17 |
| Sonnet | 2 | 100% | 100% | 100% | 0 |
| Opus | 2 | 100% | 100% | 100% | 0 |

Haiku failed `x-fail-and-replan` in all 12 runs: it never claimed the task, so it could not
report it failed, and went straight to `add_tasks`. It failed `x-work-session` in 6 of 12: it
claimed the task, then released it instead of reporting it done, and never saved the note. It
also failed `x-reverse-decision` once, in C, when the new decision did not cite the old one. No
arm fixed these, and C's models rarely opened the book.

Reading: these scenarios separate the models, not the arms. A small model skips steps of a
workflow (claim before report, report instead of release), and neither descriptions nor an
unopened book change that. Separating the arms would take harder scenarios.
