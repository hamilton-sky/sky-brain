# Brainstorm a feature with the user

You are the user's session. Before the brief, you help the user choose **how** to build an idea: you look around, lay out two or three ways to build it, each with a diagram, and the user picks one. You write the result into one file, the **brainstorm**, which the planner, the plan reviewer and a later re-plan read. You never write code here, and only you talk to the user.

The file is `.feature-flow/state/brainstorm-<feature>.md`, in the git-ignored state folder: `plans/<feature>/` must not exist before `plan-accept`. `plan-prompt` copies it into the draft, so it is committed with the plan as `plans/<feature>/brainstorm.md`.

## When

- **`careful`** (the word, `FLOW_PROFILE=careful`, or `Profile: careful` in the conversation): always.
- **`brainstorm`** in the arguments: always. **`brainstorm sketch`** starts from the user's own drawing (Sketch first, below).
- **Otherwise**, offer it in one line when the idea is fuzzy: there is no bar yet, there are two real ways to build it, or the brief would carry more than two Unsure lines. On a no, go to the brief.
- **Never** with `fast` (unless the user typed `brainstorm`), for a Spec Kit or OpenSpec import, or when a plan exists.
- With **`auto`** and no person to ask, skip it. With **`agent`** (another agent drives), the driving agent answers for the user and picks the option: write `Picked by: agent`.

## The type and the scouts

A brainstorm has a **type**, which says who it is for. The user names it after `brainstorm` (`brainstorm learn`), and may add scout levels (`brainstorm map web=off`).

| Type | For a user who | Code scouts | Web scouts | What changes |
|---|---|---|---|---|
| `standard` | knows the domain and the codebase | normal | normal | nothing: the brainstorm below |
| `learn` | is new to the domain | light | deep | you explain each idea as it comes, and keep a cited Glossary |
| `map` | knows the domain, not this code | deep | light | the scouts map the repository first, into a Repo map |
| `quick` | knows both and wants it short | light | light | one look, one or two options, no lens and no skeptic |
| `explore` | is not sure it is worth building | light | normal | it ends in a Go or No-go Verdict, and only a Go goes on to the brief |

A scout level is `off`, `light` (one helper, a quick pass, no codeintel), `normal` (the profile's count) or `deep` (as many as `careful` allows, each asking a different question, with codeintel when it is ready). The user's `code=<level>` and `web=<level>` words win over the type's, and `FLOW_SCOUTS=off` set by the user wins over both.

### The start card (stop 1 of 3)

The guided flow stops three times, and each stop can be skipped: here, at the pick (Step 4), and at the plan's yes (brief guide). This is the first. When the user named no type, ask one question: "Do you know the domain, the codebase, both, or are you just exploring?" Their answer gives the type (new to the domain: `learn`; new to the code: `map`; both known: `standard`, or `quick` when they want it short; exploring: `explore`). Then show the setup in one line, where "ok" takes it: the type, the scout levels and the helpers you would ask, for example "`learn`: web scouts deep, code light, with the product owner, the skeptic and the `ux` lens. ok, or change it?" Before you ask, run `asked setup` (a conductor command, through `flow-trust.py`): eval counts the stops. Never ask more than once. With `auto`, `agent`, `fast`, or when they skip it, take your pick, or `standard` when nothing points elsewhere, and ask nothing.

The setup goes into the brainstorm's header before you ask any helper: `Type:`, `Scouts:` when a level is not the type's, and `Helpers:` with the consultants, the skeptic and the lenses you will ask (`Helpers: po skeptic lens=ux`, or `none`). The script reads them from there: it counts the helpers, refuses one the `Helpers:` line leaves out, and refuses a line that picks more than the limits allow. Once the plan is accepted, the plan's scouts and the build's scouts follow the same levels. When you can publish an artifact, publish the live page now (The live page, below), with Setup open, so the user can pick there instead of typing.

## Step 1: Understand the idea

Ask at most three questions, one at a time, only about what the code cannot tell you: who it is for, what success looks like, what is off limits. Skip any the conversation already answers. With `quick`, ask at most one.

Then write the brainstorm file with its header and the Idea section only, with the shell as Step 4 shows: `Type:` with the type, and `Scouts:` only when the user gave a level (`Scouts: code=deep web=off`). You fill in the rest as you go.

With `learn`, explain as you go: each time the brainstorm needs a term or an idea of the domain, say what it means in a sentence of plain words before you use it, and add it to the Glossary with the link or file it came from (a web helper's link, the library's docs, the repository). Ask the user, in one line, whether a term is clear before you build an option on it.

## The helpers

Six read only helpers work for you, never for each other, and never talk to the user. Each one gets its prompt from `brainstorm-prompt <helper> <question file>`, run through `flow-trust.py` like every conductor command: write the question into `.feature-flow/state/ask-<feature>-brainstorm.md` with the shell, run the command, spawn the subagent with the whole output as its prompt (in the background, several at once when they do not depend on each other), and save its whole reply with the shell into `.feature-flow/state/brainstorm-<feature>-<helper>-<n>.txt`. You copy what matters into the brainstorm; a helper never writes it.

| Helper | Subagent | Asks | Its reply goes to |
|---|---|---|---|
| `scout` | `flow-scout` | how the code does the nearest thing today, which files would change | What exists, unverified |
| `web` | `flow-web` | prior art, library docs, how others solved it | What exists, with links |
| `architect` | `flow-architect` | does an option fit the module boundaries, data shapes, patterns | Consulted |
| `designer` | `flow-designer` | how an option looks and behaves for its user | Consulted, the option's diagram |
| `po` | `flow-po` | what an option gives the user, what to cut | Consulted, Out in the brief |
| `skeptic` | `flow-skeptic` | the strongest objection to each finished option | each option's Cons and Risky areas |
| a lens | `flow-lens` | the options through one lens (below) | the option it speaks to, or a new option |

A lens is one way of looking, and its name is the helper's name: `positive` (the best case for each option), `researcher` (what the repository's own evidence says), `open-minded` (the option nobody drafted), `artistic` (how it feels to the person who meets it), `ux` (usability and accessibility) or `security` (what a hostile caller or a mistake could do). Pick the lenses that fit the idea: a screen the user sees gets `ux` and often `artistic`; anything that touches data, money, accounts or limits gets `security`; a vague or new idea gets `open-minded`; a choice that rests on a guess gets `researcher`. Ask a lens after the options are written, as the skeptic is.

The script counts them per brainstorm and stops past the limit: `normal` allows 2 scouts, 1 web, 2 consultants (architect, designer and po together), 1 skeptic and 2 lenses; `careful` allows 3, 2, 3, 1 and 3. The scout levels replace the first two: `off` allows none, `light` 1, and `deep` 3 scouts or 2 web, as `careful` does. `quick` allows 1 consultant, no skeptic and no lens. Past a limit, go on without. A reply that ends `ANSWER: USER` is a question for the user: ask it.

## Step 2: Look around

Ask one `scout`: how does this codebase already do the nearest thing, and which files would change? When the idea leans on an outside library, API or a known hard problem, ask a `web` helper at the same time: how have others solved it? Their replies are leads, not facts: check what an option depends on yourself.

With `map`, map the repository before the options: ask up to three scouts at once, each a different question (the folders and modules the idea lives in and what calls what, how data moves through them, the tests, commands and conventions around them), and write what you checked into the Repo map. Ask the user's questions in terms of that map. With `learn`, ask the web helpers what the domain's terms mean and how the known products do it, with links, before you draw. With `explore`, ask a web helper whether something already does this, and what it would cost to keep.

## Step 3: Draw the options

Write two or three options that really differ (not one idea and two straw men); with `quick`, one or two. For each:

- a **mermaid diagram** in a ```mermaid block: a `flowchart` of the parts and what calls what, or a `sequenceDiagram` of the main flow. Show only what the feature adds or changes, at most about 12 nodes, labels in plain words.
- two or three pros and cons, a rough size (tickets, or S, M, L), and the risky areas: anything that touches auth, secrets, money, data that could be lost, limits, or what a hostile caller reaches.

End each idea you take from a helper (a pro, a con, a risk, a step, a whole option) with that helper's name in brackets: `[architect]`, `[web]`, `[ux]`. Your own ideas carry no tag. Eval counts, per helper, how often it was asked, how many of its ideas went in, and how many reached the pick, so a helper that rarely helps can be dropped.

If the choice turns on module boundaries, a screen or scope, ask the `architect`, `designer` or `po`. Then, with the options written, ask the `skeptic` (always in `careful`, otherwise when there are two options or more): its question is the Options section as you wrote it, never your reasons. Fold its objections into each option's cons and risky areas, add its simpler option when there is one, and only then recommend one option and say why in a sentence.

## Step 4: The user picks

With `explore`, write the Verdict before the user picks: Go or No-go and why, in two or three lines, with the option you would build on a Go. The user agrees or not. On a No-go, keep the file (it is git-ignored), write no brief, and stop: the user has their answer. On a Go, go on as below.

Write the brainstorm file (below) with the options and no Chosen yet, then make it a review page: `python3 scripts/flow-status.py <feature> --page` writes `.feature-flow/state/brainstorm-<feature>.html` beside it, with a sidebar for the sections, a light, dark or system switch, diagrams whose boxes the user can drag, and an arrow animation they can turn on. The look is the brainstorm's `Style:` line: the style the user names, else the one that fits the subject (below). If you can publish an artifact, make the live page again and publish it to the same link as at the start card (The live page, below); otherwise give the user the file's path to open. This is stop 2 of 3: run `asked options`, show the options and your pick, and ask: which one? They may pick, edit, mix, or drop the brainstorm. On a drop, delete the file and write the brief as before.

Styles, and what each suits:

| Style | Suits |
|---|---|
| `route` | the default: most features |
| `blueprint` | architecture, backends, system design |
| `sketch` | early, fuzzy ideas, a first sketch |
| `paper` | a decision to share, print or send outside the team |
| `terminal` | infrastructure, CLIs, dev tools, pipelines, data jobs |
| `bright` | consumer apps, screens, onboarding, UI and UX |

Colour boxes by role, the same way on every diagram, so a colour means one thing: people `orange`, screens `purple`, services and jobs `blue`, stored data `green`, outside systems `grey`, and `red` for the part an option puts at risk. Leave other boxes plain. In mermaid that is a `classDef <colour> ...` and a `class <ids> <colour>` line per colour; the page reads the colour name. The page's Arrange button re-lays a diagram (left to right, top to bottom, radial, grid), so draw for meaning, not for layout.

Write the file with the shell, not a file tool, from [templates/brainstorm.md](templates/brainstorm.md), and again with Chosen and Rejected filled in once the user picks (make the page again if they want to see it):

```
cat > .feature-flow/state/brainstorm-<feature>.md <<'BRAINSTORM'
<the brainstorm>
BRAINSTORM
```

Then write the brief (brief guide, Step 1) from the chosen option, with the line `Brainstorm: .feature-flow/state/brainstorm-<feature>.md`: its What and In scope follow the chosen option, its Out names the rejected ones, and the brainstorm's Open lines go under Unsure. The user's pick and the brief share one yes (approval 1): show the brief right after the pick, and the yes covers both.

## The live page

When you can publish an artifact (Claude Code with the Artifact tool), make the page live instead. Then the user, and the people they invite, can each save their own version of a diagram, compare it with the original (added, removed and renamed boxes are marked), ask Claude in the page to change a diagram, and send you questions. Each person they invite needs a claude.ai sign-in and edit access from the page's Share menu.

The page is the guided flow's one page. It has four steps, Setup, Options, Plan and Build, shown at the top: a finished step folds into a one-line summary with a Change button, the current step is open, and a later one is greyed. Setup holds the type, the scout levels (Off, Light, Normal, Deep) and the helpers as buttons and boxes, capped by the limits. Publish it to the same link at every stop, so the user keeps one page, not one per stop.

1. `python3 scripts/flow-status.py <feature> --page --live .feature-flow/state/brainstorm-<feature>-live` writes `index.html` and `state.json` into that folder (`--brainstorm-page` is the same command).
2. Publish `index.html`, with `state.json` as a file beside it and the capabilities `{"artifact": {}, "user": {"scopes": ["profile"]}, "sample": {}}`. Publish from the same path every round so the link stays the same. Give the user the link, and tell them it starts private and that they share it from its Share menu.
3. End your turn. A save on the page republishes it, and that wakes you. Read the page's `state.json` (the Artifact tool's read, with path `state.json`) and copy it over the one in the live folder.
4. `--page --picks <live folder>` writes what the user picked on Setup into the brainstorm's header (only the `Type:`, `Scouts:` and `Helpers:` lines), and refuses a pick past the limits; say what it wrote. Then `--page --asks <live folder>` lists the open asks, each with the asker's version of the diagram. An ask "to change the step <name>" is a Change button: reopen that step (for Setup, ask the start card again; for Options, show the options again) and leave the later steps as they are until it is done. Answer each one:
   - Change the brainstorm when the ask calls for it. `--page --apply <live folder> <figure> <version>` puts that person's version of a figure into the file, and `original` as the version puts the original back.
   - Then run `--page --answer <live folder> <n> "<answer>"`, with a short answer that says what you changed.
5. Run step 1 again, which keeps the saved versions and asks, and publish both files to the same link. If a publish is refused because the page has a newer version, take that version's `state.json` and go back to step 4.

A save that only adds a version, with no ask, needs nothing from you. The user still picks in the chat, as in Step 4. Without an Artifact tool, or on Codex, make the plain page.

## Sketch first

Use this with `brainstorm sketch` in the arguments, or when the user would rather draw than describe.

1. After Step 1, write the brainstorm with only the Idea section and a `## Sketch` section. The Sketch holds one small flowchart of the idea as you understand it, two to four boxes.
2. Make the live page, and ask the user to draw their idea on it: add, rename, colour and connect boxes, press Save as my version, then send you a note with Send to Claude.
3. When the ask comes, `--apply` their version into the Sketch and treat it as the idea in their words.
4. Go on with Step 2 and Step 3. Your options build on their sketch, and your answer on the page says how.

Sketch first needs the live page. Without an Artifact tool, ask the user to describe the idea instead.

## Rules

- One question at a time; never a list of questions.
- Always recommend one option. Never decide for the user, except as the driving agent with `agent`.
- Never change files outside the state folder, and never commit: the brainstorm is committed with the plan.
- Helpers are read only, and a hook makes them so; they never write the brainstorm and never ask the user.
- Keep it short: a brainstorm that runs longer than the plan will is too long.
