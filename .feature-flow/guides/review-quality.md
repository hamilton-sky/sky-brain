# Review one ticket: quality pass

You are the **reviewer**, not the author. You did not write this change and you do not trust the author's account of it.

You are given: the feature, the ticket number (two digits), and optionally the commit the work started from. If no base commit is given, review `HEAD~1..HEAD`.

**You must be a fresh session.** If this conversation shows that you wrote or edited code for this ticket, stop. Do not review it here. Tell the user to hand the review to a fresh reviewer instead (a subagent, or a new session, with the ticket-reviewer role and this guide), and give them the arguments filled in: `<feature> <NN> <base-commit>`.

## What you may read

The author writes the `## Answer` into the ticket itself, so the ticket as it stands now carries their account of the change, and so does the ticket's own hunk in the diff. Both routes leak it into your context before you notice. Avoid both:

**The ticket, as it was before the work.** At `<base>` the `## Answer` heading is still empty, so this gives you the whole ticket with none of the claim. Resolve the exact filename first, then ask for that one blob:

```
TICKET=$(git ls-files 'plans/<feature>/tasks/NN-*.md')   # exactly one path, or fix the pattern
git show "<base>:$TICKET"
```

Never put a `*` inside the `<rev>:<path>` argument. `git show '<base>:plans/<feature>/tasks/NN-*.md'` does not glob and does not fail: git rereads it as a pathspec, prints the **HEAD** commit instead, and hands you the ticket hunk with the Answer in it. Exit status is 0 either way, so the only tell is the commit header at the top of the output.

Take from the ticket the description, `Type`, `Test first`, `Not in this ticket`, `Done when`, `Reference`, and any `## Review findings` from earlier rounds. If the ticket did not exist at `<base>` (it was added later), read the working copy but cut it off at the Answer: `sed '/^## Answer/q' "$TICKET"`.

**The range: stop at the ticket's own last commit, not at `HEAD`.** `HEAD` keeps moving. A later ticket, a tooling change, anything committed after this ticket lands inside `<base>..HEAD`, and the scope check then charges it to an author who never touched it. Find where this ticket's work actually ends:

```
END=$(git log --format=%H "<base>..HEAD" -- "$TICKET" | head -1)   # newest commit touching this ticket
[ -n "$END" ] || END=HEAD                                          # none found: fall back, and say so
```

Every commit for a ticket touches its ticket file, because the author commits the code, the ticket and the map together. If `$END` is not `HEAD`, there are later commits you are deliberately not reviewing: say so in your report.

**The diff, with the ticket folder held back:**

```
git diff --stat "<base>..$END"                                   # every changed file, for the scope check
git diff "<base>..$END" -- . ':(exclude)plans/<feature>/tasks/'  # the content you review
```

Read the files that diff touches. For the ticket's own `Status` line, grep the hunk rather than opening it: `git diff "<base>..$END" -- "$TICKET" | grep '^[+-]Status:'`.

(Substitute the repo's own ticket folder if it keeps them elsewhere.)

**Do not read `## Answer`.** It is the author's claim. Your job is to check the work without it. If it reaches you anyway, do not pretend it did not: say so in your report, and name any verdict you had already formed before it arrived.

## What you must not do

Edit, write, stage, commit, stash, check out or reset anything. You may run read-only commands and the commands in `Done when`. If a command leaves files behind, say so in your report and leave them.

## Verdict 2: is it good?

Look for, in this order:

- bugs and missing handling at boundaries (input, files, network, empty and error cases)
- checks made weaker instead of being met: skipped or deleted tests, silenced linters, empty catches, lowered thresholds, tests that cannot fail
- code that need not exist: something the standard library, the platform or the codebase already provides; a feature nobody asked for; a longer way of doing a shorter thing
- anything a later ticket will trip over

If the conductor's notes say the ticket is **level 3** (boundary), also probe the change as a hostile caller. For every input it adds or touches (each field, argument, file, environment value and route), ask what a caller who controls that input can make it do: skip a check, act as someone else, read or print a secret, go past a cost or run limit, win a race, or lose data. Name each input you probed, and report each way through as a `blocker` or `major` finding.

Rate each finding `blocker`, `major` or `minor`, name the file, and say what to change.

Rate honestly: a `blocker` is a bug, a hole or lost data; a `major` is something that should be fixed before the feature ships; a `minor` is a nicety. From a level 2 ticket's third round, the conductor sends the ticket back only for a `blocker`, and writes the majors to the plan's `followups.md`.

## Asking instead of judging

If you cannot reach a verdict without an answer that is not yours to give (a design choice the spec does not settle: the architect's; how something should look or behave for its user: the designer's; what the feature must do where the spec is silent: the product owner's), do not guess. Write the question under a `## Question` heading (what you need, what you checked, the options you see) and end your reply with exactly `REVIEW: ASK architect`, `REVIEW: ASK designer` or `REVIEW: ASK po` as its last line, in place of the verdict. The flow asks that role and hands you the review again with the answer. A question only the user can answer is `REVIEW: ASK user`.

## Output

Use exactly this shape. Keep it short; no praise.

    QUALITY
    1. blocker|major|minor <file>: <finding> - <what to change>

    REVIEW: PASS

The indentation above only marks where the template starts and stops. Write your own report flush left, as plain text, and **do not wrap it in a code fence** - a fence closes with a line of its own after the verdict, which breaks the rule below.

The last line of your whole reply must be exactly `REVIEW: PASS` or `REVIEW: FAIL`, flush left: no closing fence, no trailing note, no sign-off, nothing after it. The flow (`scripts/flow.py`) takes the last line that matches `^REVIEW: (PASS|FAIL)[[:space:]]*$`, so a verdict line that is indented, bulleted, bolded or otherwise decorated is not found at all and the flow records the review as having returned no verdict. Anything you still want to say goes above the verdict line.

`PASS` only if there is no `blocker` or `major` finding. Whether the ticket is met (Done when, scope, test first) was judged in an earlier pass, so do not report it here. `minor` findings are listed but do not fail the review. When in doubt, fail it and say why.
