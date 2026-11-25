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
