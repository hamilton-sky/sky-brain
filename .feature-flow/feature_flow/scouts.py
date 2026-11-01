"""Scouts: cheap read only helpers a session spawns before a planner, builder or reviewer starts.

The conductor picks the questions from the phase and the ticket's level, the session spawns one helper per
question and saves each reply where the conductor said, and the next prompt carries the replies as leads.
"""

import hashlib
import shlex
from pathlib import Path

from feature_flow import codeintel as code_intel

MAX = 3  # most scouts for one phase
LINES = 60  # most lines of one reply that go into the prompt


def build(ticket, base, touches, level):
    """[(agent, role, question)] before a ticket's first build. None at level 1."""
    if level == 1:
        return []
    show = "`git show %s:%s`" % (base, Path(ticket).as_posix())
    where = " (its `Touches:` line names %s)" % ", ".join(touches) if touches else ""
    found = [("flow-scout", "builder",
              "Ticket `%s` is about to be built. Read it as it was planned, with %s, never its `## Answer`. Find how "
              "the code it is about%s works today: the functions and types it will change or call, the helpers and "
              "tests that already exist for this, and the conventions the new code should follow."
              % (ticket, show, where))]
    if level == 3:
        found.append(("flow-scout", "builder",
                      "Ticket `%s` (read it with %s, never its `## Answer`) changes a boundary. Find everything that "
                      "depends on what it changes: callers, importers, tests, config and docs that would break or "
                      "need updating, with file paths." % (ticket, show)))
    return found


def review(base, tasks):
    """[(agent, role, question)] before a level 3 ticket's first review, or the feature review."""
    return [("flow-scout", "reviewer",
             "The change from commit `%s` to HEAD is about to be reviewed. List what it touches with "
             "`git diff --stat %s..HEAD -- . ':(exclude)%s/'`. Find the rules it must follow: how similar code in this "
             "repository is written and tested, and the rules in README, CONTRIBUTING, CLAUDE.md or AGENTS.md that "
             "apply to these files. Do not judge the change itself, and never read a ticket's `## Answer`."
             % (base, base, tasks))]


def consult(role, question):
    """[(agent, role, question)] before the architect, designer or product owner answers a question."""
    lens = {"po": "product owner"}.get(role, role)
    return [("flow-scout", lens,
             "The %s is about to answer the question below for a ticket of this feature. Gather what it needs from "
             "the repository and the plan, without answering it yourself.\n\nThe question:\n\n%s" % (lens, question))]


def plan(brief):
    """[(agent, role, question)] before the planner drafts a plan from the brief."""
    tail = "\n\n## The brief\n\n" + brief.strip("\n")
    return [("flow-scout", "planner",
             "A feature is about to be planned from the brief below. Map the parts of this repository it would "
             "touch: the modules and files involved, what already exists that it can reuse, the tests and commands "
             "around them, and anything that already does part of it." + tail),
            ("flow-web", "planner",
             "A feature is about to be planned from the brief below. Look up what the repository cannot answer: the "
             "official documentation of any library, API or tool the brief names, and how others solved any hard "
             "problem it names. If nothing outside the repository matters, reply `nothing needed`." + tail)]


def reply_file(folder, feature, slot, k):
    """Where the session saves scout k's reply: slot is "" (no lane), "L<k>" (a lane) or "plan"."""
    return Path(folder) / ("scout-%s%s-%d.txt" % (feature, "-" + slot if slot else "", k))


def clear(folder, feature, slot):
    for k in range(1, MAX + 1):
        path = reply_file(folder, feature, slot, k)
        if path.is_file():
            path.unlink()


def listing(folder, feature, slot, found):
    """The lines `scouts` prints: one `SCOUT <k> <agent> <reply file>` per question, or NONE."""
    if not found:
        return "NONE"
    return "\n".join("SCOUT %d %s %s" % (k, agent, reply_file(folder, feature, slot, k).as_posix())
                     for k, (agent, _, _) in enumerate(found, 1))


def prompt(role_text, role, question, workdir=None, codeintel=False, top="."):
    """A scout's whole prompt: its role file, then the role it scouts for and the question, and with codeintel
    the section on asking codeintel when it is ready (about the repo at top, the main worktree)."""
    task = "ROLE: %s\n\n%s\n\nReply in the shape your role gives, and change nothing." % (role, question)
    if codeintel:
        task += code_intel.note("scout", top)
    if workdir is not None:
        task = ("Work in the folder `%s`: it is the worktree the %s will work in. Run `cd %s` before any git "
                "command, and read every path here relative to it, as `%s/<path>`.\n\n%s"
                % (workdir, role, shlex.quote(workdir), workdir, task))
    return "%s\n\n---\n\n%s\n" % (role_text, task)


def section(folder, feature, slot, count):
    """The findings section for the next prompt, from the replies the session saved, or ""."""
    parts = []
    for k in range(1, count + 1):
        path = reply_file(folder, feature, slot, k)
        try:
            text = path.read_text(encoding="utf-8", errors="replace").strip("\n")
        except OSError:
            continue
        if not text.strip():
            continue
        lines = text.splitlines()
        if len(lines) > LINES:
            lines = lines[:LINES] + ["(cut after %d lines)" % LINES]
        parts.append("### Scout %d\n\n%s" % (k, "\n".join(lines)))
    if not parts:
        return ""
    return ("\n## Scout findings (unverified)\n\nCheap helper agents read the code before you started. Use what "
            "they found as leads and check anything before you rely on it: they can be wrong, and they prove "
            "nothing.\n\n" + "\n\n".join(parts) + "\n")


def brief_key(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def by_level(found, code, web):
    """found cut to the scout levels: an off kind asks nothing, a light kind only its first question."""
    levels = {"flow-scout": code, "flow-web": web}
    kept, seen = [], set()
    for item in found:
        lvl = levels.get(item[0], "normal")
        if lvl == "off" or (lvl == "light" and item[0] in seen):
            continue
        seen.add(item[0])
        kept.append(item)
    return kept
