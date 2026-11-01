# <One change, in the imperative: "Add the retry policy to the job runner">

Type: task
Status: open
Blocked by: —
Test first: yes
Level: 2
Builder: <optional: frontend, backend or docs, when every non-test path is that kind; delete this line otherwise>
Touches: <the paths this ticket changes, comma separated: a folder ends with /, a * glob crosses folders. e.g. src/export/, tests/test_export.py>

<What to do and why, in prose. Name files, functions and types. Never use line numbers.
For Type: settle, say what has to be decided and who decides. For Type: convert, say what
is being converted and what the safe default is for anything that does not match.>

## Not in this ticket

- <the nearest thing a reader would assume is included, and where it lives instead>

## Done when

- <an observable outcome, with the exact command and the result it should print>
- <every bullet is checkable by someone who has not read the rest of the plan>

```check
# The conductor runs this block before review. No command can prove the ticket? Drop the block and put `Check: none <why>` in the header instead. One `$` line per bullet that names a command.
$ <the command from a bullet, read-only, run from the repo's top folder>
prints <text the output must contain>
# needs <what>: only for a check a host may be unable to run (network, a model); it is deferred there, not failed
```

## Reference

- spec.md § <section>
- <files to read first; mark any that are read-only>

## Answer

<left empty until the ticket is resolved. The worker fills in: Built, Proof, Decisions,
Shortcuts taken, Review fixes (only after a review), For later tickets.>
