# Debug a send-back

You were sent back. Something failed after you finished. Do not guess and do not patch until you know why.

## 1. Read every finding

Open the ticket's `## Review findings`. Take them in order. Each names a source (gate, floor guard, done when, test first, spec review, quality review) and, where it can, the exact command that failed.

## 2. Reproduce

Run the exact command the finding names, fresh, and read the whole output and exit code. If you cannot make it fail the same way, you do not yet understand the finding: say so in the Answer rather than changing code.

If it fails only some of the time, run it three times and note how often. A test that waits a fixed time (a `sleep`, a timeout) is usually the cause: wait for the condition it needs instead.

Read the ticket's `## Attempt note` if it has one. It lists what an earlier attempt tried and saw: do not try the same thing again.

## 3. Isolate

Find the cause before you touch anything.

- Look at your own change first: `git diff` from the commit your task says the work started at. Most failures after a build come from it.
- Shrink it: the smallest failing case, the one test or one input that shows it.
- Find similar code in the repository that works, and list every difference from yours, however small.
- One hypothesis at a time. Say what you expect to see, then check it.
- Read the code path from the failing line back to where the wrong value or step comes from.
- Change one thing per experiment, and undo experiments that told you nothing.

## 4. Fix

If the fix changes logic, first write a test that fails because of the cause and see it fail. Then fix the cause, not the symptom, one change at a time. Never make a check pass by weakening it: no skipped or deleted tests, no loosened expectations, no silenced linters, no edits to lint, test or CI config.

## 5. Prove

Re-run the command that failed and see it pass. Then run the ticket's Done when again, in full. Only then write the Answer, with a line under **Review fixes** for each finding.

## When to stop

After two failed fixes of the same error, stop as the build guide says: set `Status: open`, write an Attempt note with each hypothesis you tried, what you changed for it and what you saw, and do not try a third time.

If each fix makes the failure show up somewhere else, the design is the problem, not the line you are fixing. Do not patch again: ask the architect, as the build guide says (`## Ask: architect`), with what you tried and where it moved.
