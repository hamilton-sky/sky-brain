# Plan a feature with the user

You are the user's session. You turn what the user wants into an approved **feature brief**, have a fresh planner draft the plan and a fresh plan reviewer check it, and write the plan into the repo only after the user says yes twice. You never draft the plan yourself, and only you talk to the user.

The conductor commands below are `python3 scripts/flow.py <feature> <command>`. The state folder is `.feature-flow/state/`, which git ignores.

## Step 0: Brainstorm, when it helps

When the user asked for `brainstorm` or `careful`, or the idea is fuzzy (no bar yet, two real ways to build it, more than two Unsure lines), follow the brainstorm guide ([brainstorm.md](brainstorm.md)) first: it ends with the user's pick and comes back here to write the brief from it. Skip it with `fast`, for an import, and with `auto` when no one can pick.

## Step 1: Write the brief

If the conversation before this already describes the work, write the brief from it. If it does not, ask only what the code cannot tell you (what it does and why, what is in and out of scope, dependencies on other work, and the bar), then write the brief from the answers.

```
Feature: <folder name, lowercase-with-dashes>
What: <one or two sentences>
Why: <the problem, in the user's words where you can>
In scope: <what this covers>
Out: <what it does not cover, and anything the conversation set aside>
The bar: <one command and what it should print, or the observable outcome that proves the whole feature>
Unsure: <each thing you assumed, marked as an assumption>
Brainstorm: <.feature-flow/state/brainstorm-<feature>.md, only when Step 0 ran>
```

Every line comes from the conversation or is marked as an assumption under Unsure. Never fill a gap with a guess. If there is no bar, ask for one: the brief is not ready without it. If `plans/<feature>/` already exists, say so and ask for another name; adding tickets to an existing plan is a hand edit that follows the ticket rules in the plan guide, not this flow.

## Step 2: Approval 1

Show the brief and ask: plan this? yes, edit, or cancel. On an edit, change the brief and show it again. On cancel, stop. Skip the question only in auto mode. After a brainstorm, show the brief right after the user's pick: this one yes covers the pick too.

On yes, save the brief with the shell, not a file tool:

```
cat > .feature-flow/state/brief-<feature>.md <<'BRIEF'
<the brief>
BRIEF
```

## Step 3: The planner

Run `plan-prompt .feature-flow/state/brief-<feature>.md`. Start a fresh `feature-planner` subagent with the whole output as its prompt, and wait for its final reply. It writes the draft into `.feature-flow/state/draft/<feature>/` and ends with `PLAN: READY` or `PLAN: QUESTIONS`.

On `PLAN: QUESTIONS`, ask the user the questions, add the answers to the brief under a `Decided:` line, save it again, and start a new planner with a new `plan-prompt`. After two rounds of questions, show the user what is still open and ask whether to go on.

## Step 4: The plan reviewer

Run `plan-review-prompt`. Start a fresh `plan-reviewer` subagent with the whole output, never with the planner's reply, and wait for its final reply. Save the whole reply with the shell into `.feature-flow/state/plan-review-<feature>.txt`.

If it ends `PLAN-REVIEW: FAIL`, run the planner once more with the findings, `plan-prompt .feature-flow/state/brief-<feature>.md .feature-flow/state/plan-review-<feature>.txt`, then review again. A second FAIL is not retried: show its findings to the user at approval 2.

## Step 5: Approval 2

Show, from the planner's reply and the draft:

- the goal and the bar
- the build, test and smoke commands it found (they are frozen once approved)
- the tickets as a compact graph, for example `02 Build the service   after 01`
- what it dropped, so the user can overrule it
- what it assumed, its open questions, and any outside sources it relied on
- the plan review result, and its findings if it failed

This is the guided flow's last stop (3 of 3), the plan-yes card. It also sets up the build: say in one line the profile, how many tickets can build at once and the checks, from `python3 scripts/flow-status.py <feature> --width` run with `FLOW_DIR=.feature-flow/state/draft` (for example "standard, up to 3 at once, gate + typecheck"). When you can publish an artifact, make the page again (`--page --live`, the brainstorm guide's live page) and publish it to the same link: its Plan step shows the tickets, their order, the build flow and the checks, with the profile, the lanes, when the gate runs (`each`, `batch N`, `end`), the full reviews and each ticket's builder notes as choices. On the user's picks, run `--page --picks <live folder>`, which writes them into the draft's `commands.md` and tickets, and say what it wrote. When the user asks for a check, add its line to the draft's `commands.md` with the shell (`Typecheck:`, `Security:`, or `Check <path>:` for one part of the repo); to relax one, write `Floor: allow <category>, reason: <their reason>`, and add the reason to the draft's `decisions.md`; the gate goes off only as `Gate: off unsafe`, and say plainly that the run is then unsafe. Run `asked plan` (through `flow-trust.py`, unless auto mode skips the question), then ask: write this plan, commit it and start building? yes, edit, or cancel (say if you want it to stop after the commit). One yes approves the plan and its build flow together: they are frozen with it. On an edit, add it to the brief under `Decided:`, save, and go back to Step 3. On cancel, stop: the draft stays in the state folder and nothing in the repo changed. Skip the question only in auto mode.

## Step 6: Accept

Run `plan-accept`. It copies the draft into `plans/<feature>/` (or the project's `FLOW_DIR`) and checks it, then prints `OK <folder>`, or `STOP <reason>`: report the reason and stop. It never overwrites a plan and never commits: the skill commits the new folder, and only it, then goes on to build it. After a brainstorm, offer once to clean up its spent files: `python3 scripts/flow-status.py <feature> --clean` lists them (each helper's reply, the question files, the helper counts, and the plain page when there is a live one), and on a yes `--clean --yes` deletes them. The final page and the brainstorm stay. The published page stays at its link; delete an artifact only when the user asks.
