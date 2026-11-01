"""The prompts a session hands to its builder and reviewer, built from the role files and the guides.

The text is runtime neutral: any agent that can read a prompt can follow it.
"""

import re
import shlex
from pathlib import Path

from feature_flow import builders, codeintel

ROLES = {"build": "ticket-builder.md", "review": "ticket-reviewer.md", "review-quality": "ticket-reviewer.md",
         "review-single": "ticket-reviewer.md",
         "review-feature": "ticket-reviewer.md", "plan": "feature-planner.md", "plan-review": "plan-reviewer.md",
         "scout": "flow-scout.md", "web": "flow-web.md", "ask-architect": "flow-architect.md",
         "ask-designer": "flow-designer.md", "ask-po": "flow-po.md", "replan": "feature-planner.md",
         "skeptic": "flow-skeptic.md", "test": "flow-tester.md", "lens": "flow-lens.md"}
GUIDES = {"build": "build.md", "review": "review.md", "review-quality": "review-quality.md",
          "review-single": "review-single.md", "review-feature": "review-feature.md", "plan": "plan.md",
          "plan-review": "plan-review.md", "replan": "replan.md", "test": "test.md"}


def find_file(scripts, folder, name, top="."):
    """folder/name beside the scripts folder (a checkout), else in top's .feature-flow/ (an install).

    top is the main worktree's top: the working folder by default, the main worktree while a lane works, so
    the guides and roles are never the lane's copies. A candidate counts only when it holds the file, so an
    unrelated guides/ or agents/ folder in the user's repo does not hide the installed one.
    """
    for root in (Path(scripts).parent, Path(top) / ".feature-flow"):
        path = root / folder / name
        if path.is_file():
            return path
    raise FileNotFoundError("cannot find %s/%s beside scripts/ or in .feature-flow/" % (folder, name))


def lens(scripts, name, top="."):
    """A brainstorm lens's guide, guides/lenses/<name>.md."""
    return _body(find_file(scripts, "guides", "lenses/%s.md" % name, top))


def _body(path):
    text = Path(path).read_text(encoding="utf-8")
    if text.startswith("---\n"):
        parts = text.split("\n---\n", 1)
        if len(parts) == 2:
            text = parts[1]
    return text.strip("\n")


def _runner(text, scripts):
    """Point `python3 scripts/` at the scripts folder that is running, unless it is the repo's own."""
    folder = Path(scripts).absolute()
    if folder == Path.cwd() / "scripts":
        return text
    base = folder.as_posix()
    return re.sub(r"python3 scripts/([\w.-]+)", lambda m: "python3 " + shlex.quote(base + "/" + m.group(1)), text)


def role(scripts, name, top="."):
    """A role file's body, ready to go in front of a prompt."""
    return _runner(_body(find_file(scripts, "agents", name, top)), scripts)


def _templates(text, guides):
    """Replace the guide's `[label](templates/x.md)` links with the path of the file in the folder it was read from.

    The link is relative to the guide, which the planner does not read from the repo root. The path is
    relative to the working folder when the guides are inside it, else absolute. It goes in a code span, not a
    link destination, so no character in the path needs escaping.
    """
    guides = Path(guides).absolute()
    try:
        base = guides.relative_to(Path.cwd()).as_posix()
    except ValueError:
        base = guides.as_posix()

    def span(path):
        longest = max([len(run) for run in re.findall("`+", path)] or [0])
        fence = "`" * (longest + 1)
        pad = " " if path.startswith("`") or path.endswith("`") else ""
        return fence + pad + path + pad + fence

    return re.sub(r"\[([^\]]*)\]\(templates/([\w.-]+)\)",
                  lambda m: "%s (%s)" % (m.group(1), span(base + "/templates/" + m.group(2))), text)


def builder_note(scripts, ticket_path, top="."):
    """The ticket's `Builder:` note (guides/builders/<name>.md) as prompt parts, or none."""
    name = builders.ticket_builder(ticket_path)
    if not name:
        return []
    try:
        note = _body(find_file(scripts, "guides", "builders/%s.md" % name, top))
    except FileNotFoundError:
        return ["The ticket names the `%s` builder, which has no notes in guides/builders/: build it with the build "
                "guide alone." % name]
    return ["The ticket names the `%s` builder. Its notes follow. They add to the build guide and never override it."
            % name, note]


def build(phase, scripts, feature, ticket, num, sha, notes=(), retry=False, workdir=None, top="."):
    role_text = role(scripts, ROLES[phase], top)
    guide = _runner(_body(find_file(scripts, "guides", GUIDES[phase], top)), scripts)
    for placeholder, value in (("<feature>", feature), ("<NN>", num), ("<ticket>", ticket), ("<sha>", sha),
                               ("<base>", sha), ("<base-commit>", sha), ("<start-commit>", sha)):
        guide = guide.replace(placeholder, value)
    fresh = ("Run `git log` and `git status` yourself before you start: a git snapshot taken when your "
             "session began can be stale.")
    if phase == "build":
        task = ("Your task: build ticket %s of the feature `%s`, in auto mode (`%s auto %s`). The ticket is `%s`. "
                "The work starts at commit `%s`.\n%s\nWhen you are done, reply with what you built and the "
                "commit. Do not review your own work." % (num, feature, feature, num, ticket, sha, fresh))
        task += codeintel.note("builder", top, sha)
        intro = "The build guide follows. Follow it exactly."
    else:
        task = ("Your task: review ticket %s of the feature `%s` (`%s %s %s`) (%s pass). The ticket is `%s`, and the "
                "work started at commit `%s`.\n%s\nDo not edit any file or create a commit. Your final reply must end "
                "with exactly `REVIEW: PASS` or `REVIEW: FAIL`."
                % (num, feature, feature, num, sha, {"review-quality": "quality", "review-single": "single"}.get(phase, "spec"), ticket, sha,
                   fresh))
        for note in notes:
            task += "\nThe conductor notes: %s" % note
        task += codeintel.note("reviewer", top, sha)
        intro = "The review guide follows. Follow it exactly."
    if workdir is not None:
        folder, branch = workdir
        task = ("Work in the folder `%s`: a git worktree on the branch `%s`, made for this ticket while other tickets "
                "are built beside it in their own folders. Change to it first (`cd %s`) and run every command there. "
                "The ticket, the plan and every path in this prompt are relative to it. %s outside it, and do not "
                "switch its branch.\n%s" % (folder, branch, shlex.quote(folder),
                                            "Never change a file" if phase == "build" else "Read only; never change a file",
                                            task))
    parts = [role_text, "---", intro, guide]
    if phase == "build":
        parts += builder_note(scripts, Path(workdir[0]) / ticket if workdir is not None else Path(ticket), top)
    parts += ["---", task]
    if retry and phase == "build":
        parts += ["The debugging guide follows. Follow it before you change any code.",
                  _body(find_file(scripts, "guides", "debug.md", top))]
    return "\n\n".join(parts) + "\n"


def feature_review(scripts, feature, plan, base, nums, notes=(), tasks="tasks", top="."):
    """The prompt for the one review of a whole feature that fast mode defers the reviews of tickets nums to."""
    role_text = role(scripts, ROLES["review-feature"], top)
    guide = _runner(_body(find_file(scripts, "guides", GUIDES["review-feature"], top)), scripts)
    for placeholder, value in (("<feature>", feature), ("<tasks>", plan + "/" + tasks), ("<plan>", plan), ("<base>", base)):
        guide = guide.replace(placeholder, value)
    task = ("Your task: review the whole feature `%s` (feature pass), from commit `%s` to HEAD. The plan is in `%s`. "
            "These tickets were built in fast mode without a review of their own: %s.\n"
            "Run `git log` and `git status` yourself before you start: a git snapshot taken when your session began "
            "can be stale.\nDo not edit any file or create a commit. Your final reply must end with exactly "
            "`REVIEW: PASS` or `REVIEW: FAIL`." % (feature, base, plan, ", ".join(nums) or "none"))
    for note in notes:
        task += "\nThe conductor notes: %s" % note
    task += codeintel.note("reviewer", top, base)
    parts = [role_text, "---", "The feature review guide follows. Follow it exactly.", guide, "---", task]
    return "\n\n".join(parts) + "\n"


def tester(scripts, feature, plan, base, command, folder, rulings=(), notes=(), top="."):
    """The tester's prompt: write the acceptance tests from the plan's spec, or (with rulings) change the ones the
    product owner ruled wrong. It never gets the tickets or anything a builder wrote."""
    role_text = role(scripts, ROLES["test"], top)
    guide = _runner(_body(find_file(scripts, "guides", GUIDES["test"], top)), scripts)
    for placeholder, value in (("<feature>", feature), ("<plan>", plan), ("<folder>", folder), ("<base>", base),
                               ("<acceptance>", command)):
        guide = guide.replace(placeholder, value)
    if rulings:
        task = ("Your task: the product owner ruled some acceptance tests of the feature `%s` wrong. Change those "
                "tests in `%s` as the rulings below say, and nothing else. The plan is in `%s`. Commit your change." %
                (feature, folder, plan))
        task += "\n\nThe rulings:\n\n" + "\n".join("- " + r for r in rulings)
    else:
        task = ("Your task: write the acceptance tests of the feature `%s` from its spec, before any of it is built. "
                "The plan is in `%s`. Write the tests only under `%s`, so that `%s` runs them, and commit them. The "
                "work starts at commit `%s`." % (feature, plan, folder, command, base))
    task += ("\nRun `git log` and `git status` yourself before you start: a git snapshot taken when your session began "
             "can be stale.\nWhen you are done, reply with what you tested and what you could not.")
    for note in notes:
        task += "\nThe conductor notes: %s" % note
    parts = [role_text, "---", "The test guide follows. Follow it exactly.", guide, "---", task]
    return "\n\n".join(parts) + "\n"


def plan(phase, scripts, feature, draft, brief, findings="", brainstorm=False, top="."):
    """The prompt for the feature-planner (phase "plan") or the plan-reviewer ("plan-review").

    Both get the approved brief and the draft folder, never the conversation or each other's reasoning.
    """
    role_text = role(scripts, ROLES[phase], top)
    guide_file = find_file(scripts, "guides", GUIDES[phase], top)
    guide = _templates(_runner(_body(guide_file), scripts), guide_file.parent)
    guide = guide.replace("<feature>", feature).replace("<draft>", draft)
    if phase == "plan":
        task = ("Your task: plan the feature `%s` from the approved brief below. Write the draft only inside "
                "`%s`, laid out as the plan guide says. Do not write anywhere else and do not commit. Your final "
                "reply must end with exactly `PLAN: READY` or `PLAN: QUESTIONS`." % (feature, draft))
        intro = "The plan guide follows. Follow it exactly."
    else:
        task = ("Your task: review the draft plan for the feature `%s` in `%s` against the approved brief below. "
                "Do not edit any file or create a commit. Your final reply must end with exactly "
                "`PLAN-REVIEW: PASS` or `PLAN-REVIEW: FAIL`." % (feature, draft))
        intro = "The plan review guide follows. Follow it exactly."
    parts = [role_text, "---", intro, guide, "---", task, "## The brief", brief.strip("\n")]
    if brainstorm:
        parts += ["## The brainstorm", ("The user chose how to build this feature in a brainstorm before the brief: "
                  "`%sbrainstorm.md`. Read it first and follow its Chosen option, as the plan guide says." % draft)
                  if phase == "plan" else ("The user chose how to build this feature in a brainstorm: "
                  "`%sbrainstorm.md`. Check 11 applies." % draft)]
    if findings.strip():
        parts += ["## Review findings from the last round", "The draft is already in `%s`. Fix each finding in it, "
                  "or say in your reply why it stays." % draft, findings.strip("\n")]
    return "\n\n".join(parts) + "\n"


def replan(scripts, feature, plan, open_tickets, brainstorm=False, top=".", repair=None):
    """The feature-planner's prompt to fold a running feature's open tickets into fewer, in place; with repair (the
    stopped ticket's path, or "" between tickets), to repair the plan instead."""
    role_text = role(scripts, ROLES["replan"], top)
    guide_file = find_file(scripts, "guides", GUIDES["replan"], top)
    guide = _templates(_runner(_body(guide_file), scripts), guide_file.parent)
    guide = guide.replace("<feature>", feature).replace("<plan>", plan)
    task = ("Your task: the feature `%s` is over its time budget. Re-plan its open tickets in `%s` into fewer, as "
            "the re-plan guide says. Edit only the ticket files listed below and add new ones beside them. Do not "
            "commit. Your final reply must end with exactly `PLAN: READY` or `PLAN: QUESTIONS`." % (feature, plan))
    if repair is not None:
        task = ("Your task: repair the plan of the feature `%s` in `%s`, as the re-plan guide's Repair section says. %s"
                "Do not commit. Your final reply must end with exactly `PLAN: READY` or `PLAN: QUESTIONS`."
                % (feature, plan, "The build stopped on `%s`: read it, its Attempt notes and its findings, to see what "
                   "the plan missed. " % repair if repair else ""))
        return "\n\n".join([role_text, "---", "The re-plan guide follows. Follow it exactly.", guide, "---", task]) + "\n"
    listing = "\n".join("- `%s`" % path for path in open_tickets)
    if brainstorm:
        task += ("\nThe user chose how to build this feature in `%s/brainstorm.md`: the folded tickets still build its "
                 "Chosen option." % plan)
    return "\n\n".join([role_text, "---", "The re-plan guide follows. Follow it exactly.", guide, "---", task,
                         "## The open tickets", listing]) + "\n"
