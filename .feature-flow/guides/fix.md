# Fix a bug with the user

You are the user's session. The user named something that is broken. You find out why, without changing anything, show the user what you found, and on their yes turn it into a plan of one ticket that a builder fixes and a reviewer checks, like any other ticket. There is no brief, no planner and no plan reviewer: the diagnosis is the plan. Only you talk to the user.

Use this path for one bug with one cause. When the diagnosis shows more than that (two causes, a fix across many parts of the code, or a choice that changes what the user gets), say so and offer the usual plan instead (`/feature-flow <feature>`, with `brainstorm` when there are real options). For a one-line edit you could check by eye, say feature-flow is more than it needs.

The state folder is `.feature-flow/state/`, which git ignores. `<S>` is the scripts folder the skill names.

## Step 1: Reproduce

Find a command that shows the bug: the failing test, the script and its input, the request. Run it fresh and read the whole output and the exit code. Look for a command that fails now and will pass once the bug is gone, with no network and no prompt, run from the repo's top folder. It becomes the ticket's check, so it must not change files.

- If the user gave a command or an error, start from it. If they gave a symptom, ask once for the steps that show it.
- If it fails only some of the time, run it three times and note how often.
- If you cannot make it fail, say so and stop. Never guess a cause for a bug you have not seen.

## Step 2: Find the cause

You change nothing here: no edits, no commits, no installs. Read and run read-only commands only.

- Look at what changed first: `git log -p` on the files the error names.
- Shrink it: the smallest input or the one test that shows it.
- Find similar code in the repository that works, and list every difference.
- Take one hypothesis at a time. Say what you expect to see, then check it.
- Follow the failing line back to where the wrong value or step comes from.

Stop when you can say the cause in one paragraph and point at the code. Name the paths the fix will change, the regression test's file included. Those become the ticket's `Touches:`.

## Step 3: Write the diagnosis

Write it with the shell into `.feature-flow/state/fix-<feature>.md`. `<feature>` is a short name for the bug, lowercase with dashes (`fix-empty-export`):

```
# Fix: <one line: what is broken>

Repro: `<the command from Step 1>`
Expect: <optional: prints <text> the fixed output must contain; leave the line out when exit 0 is enough>
Touches: <the paths the fix changes, tests included, comma separated>
Level: <2; 1 for a fix in tests, docs or prompt text; 3 for auth, tokens, permissions, money, data loss or this flow's own code>
Cause: <the root cause, one paragraph, naming files and functions>
Fix: <the change that removes the cause, one paragraph>

## Evidence

<the commands you ran and the lines of output that matter, and the code you read>
```

## Step 4: The user's yes

This is the only stop. Show the cause, the fix and the `Repro:` command, and ask: fix it? yes, edit, or diagnosis only. On an edit, change the file and show it again. With `diagnose`, or when the user says diagnosis only, stop here: the file stays in the state folder and nothing in the repo changed. Skip the question only in auto mode.

## Step 5: The plan of one ticket

Run `python3 <S>/flow-status.py <feature> --fix .feature-flow/state/fix-<feature>.md`. It writes `plans/<feature>/` with one ticket: `Type: fix`, `Test first: yes`, your `Touches:` and level, and a check block that runs the `Repro:` command. Its `commands.md` takes the command lines (Build, Test, Lint, Smoke and the rest) of the newest plan in the repo, under `Profile: normal`, so the ticket gets the full gate and its own review.

- When it says it took the commands from another plan, show them in one line. When it says no plan has commands, fill in `commands.md` from the project's own config (package.json, Makefile, CI) and show it.
- Run `python3 <S>/flow-status.py <feature> --lint` until it is clean.
- The user's yes in Step 4 covers the plan and the build. Commit the folder and nothing else: `git add -- plans/<feature> && git commit -m "docs(<feature>): fix plan" -- plans/<feature>`.

Then build it as the skill says, from Before building on: `start`, and the loop. The builder gets the debugging guide from its first attempt. It writes the failing regression test and commits it on its own, then the fix. The conductor proves that the test failed before the fix, runs the gate, the floor guard, the footprint and the `Repro:` check, and a reviewer reads the change.
