"""The checkpoint of a checkpointed gate (`Gate: batch N` or `Gate: end` in commands.md).

Each ticket gets only the cheap checks (Quick, the floor guard, the footprint, test first) and its review is
deferred. Every N deferred tickets, and once more when no ticket is left, the checkpoint runs the full gate at HEAD
and each deferred ticket's Done when checks, then one reviewer reads the combined diff (the feature review, Final).
A failure is put on one ticket: a Done when check names its own ticket, and a red gate is traced to the first
ticket at whose last commit the gate fails. Only that ticket is reopened, with the report, and built again on top
of HEAD; the others stay deferred for the next checkpoint.
"""

import os
import re

from feature_flow import git, proof, tickets
from feature_flow.conductor import buildchecks
from feature_flow.conductor.errors import Stop

PASSED, REOPENED = "passed", "reopened"


def due(c, at_end=False):
    """True when a checkpoint runs now: a checkpointed gate, deferred tickets, and either every ticket is resolved
    (at_end), or N tickets are deferred and the feature review's last fix ticket (if one is open) is among them."""
    if not c.checkpointing() or not c.deferred():
        return False
    if c.all.get("checkpoint_sha") == git.head():
        return False  # gated at this commit already: its review is next, or it passed
    if at_end:
        return True
    if c.settings.gate_every < 2 or len(c.deferred()) < c.settings.gate_every:
        return False
    waiting = c.all.get("checkpoint_wait", "")
    return not waiting or waiting in [num for num, _ in c.deferred()]


def ticket_path(c, num):
    folder = c.plan / (os.environ.get("FLOW_TICKETS") or "tasks")
    for path in tickets.ticket_files(str(folder)):
        if tickets.number(path) == num:
            return path
    return None


def ticket_ends(c, items, base):
    """[(num, base, path, end)] for the deferred items, in the order they were built: end is the first commit on
    the first-parent line base..HEAD at which the ticket is resolved (its own commit, or its lane's merge), or None."""
    commits = git._git("rev-list", "--first-parent", "--reverse", "%s..HEAD" % base).stdout.split()
    out = []
    for num, start in items:
        path = ticket_path(c, num)
        end = None
        if path is not None:
            rel = proof.repo_relative(path)
            for sha in commits:
                try:
                    text = git.show_text("%s:%s" % (sha, rel))
                except RuntimeError:
                    continue
                if re.search(r"^Status:[ \t]*(%s)\b" % "|".join(tickets.DONE), "\n".join(text.splitlines()[:20]),
                             re.MULTILINE | re.IGNORECASE):
                    end = sha
                    break
        out.append((num, start, path, end))
    order = {sha: i for i, sha in enumerate(commits)}
    return sorted(out, key=lambda item: order.get(item[3], len(commits)))


def gate_at(c, sha, base):
    """The full gate's (source, report) with HEAD detached at sha; (None, "") when it passes."""
    git._git("checkout", "-q", "--detach", sha)
    c.st["base"] = base
    source, report, _ = buildchecks.Gate(quick=False).run(c)
    return source, report


def blame_gate(c, ends, base, home):
    """The deferred ticket that broke the gate: the first one at whose end the gate fails, found by halving the
    list (the gate passed before the first one). The last one when it fails at none of them, only at HEAD."""
    built = [item for item in ends if item[3]]
    if not built:
        return None
    c.st["batch_restore"] = home
    c.save()
    lo, hi = 0, len(built) - 1  # the gate fails at HEAD, so assume it fails at the last end too
    try:
        while lo < hi:
            mid = (lo + hi) // 2
            if gate_at(c, built[mid][3], base)[0]:
                hi = mid
            else:
                lo = mid + 1
    finally:
        git._git("checkout", "-q", home)
        c.st["batch_restore"] = ""
        c.save()
    return built[lo]


def reopen(c, item, source, report):
    """Reopen the ticket of item with what failed, take it out of the deferred list, commit."""
    num, _, path, _ = item
    round_no = c.num_all("checkpoint_round") + 1
    if round_no > c.max_rounds:
        raise Stop("the checkpoint of %s still fails after %d round(s): %s. the user decides what happens next"
                   % (c.feature, c.max_rounds, source))
    tickets.append_findings(path, round_no, "checkpoint, %s" % source, report)
    tickets.set_open(path)
    if not git.commit_file(path, "chore(%s): %s back to open from the checkpoint" % (c.feature, num)):
        raise Stop("cannot commit %s. this session must be allowed to run git commit" % path)
    c.all["deferred"] = " ".join(i for i in c.all.get("deferred", "").split() if not i.startswith(num + ":"))
    c.all["no_batch"] = " ".join(c.all.get("no_batch", "").split() + [num])  # in fast mode: built alone
    c.all.update({"checkpoint_round": round_no, "phase": ""})
    c.save()
    c.all["num"] = num
    c.log("CHECKPOINT-FAIL")


def run(c):
    """The checkpoint at HEAD: PASSED (the feature review of the deferred tickets is next) or REOPENED (one ticket
    is open again and the run goes on with it)."""
    from feature_flow.conductor.phases.final import Final  # final imports the phases, which import this
    if not git.is_clean():
        raise Stop("working tree is not clean at the checkpoint of %s, commit or stash first" % c.feature)
    home = git._git("symbolic-ref", "-q", "--short", "HEAD", check=False).stdout.strip()
    if not home:
        raise Stop("HEAD is detached at the checkpoint of %s. a builder must not switch branches" % c.feature)
    base = Final.feature_base(c)
    items = c.deferred()
    c.all.update({"num": "all", "ticket": "", "due_checks": ""})
    c.log("CHECKPOINT %d" % len(items))
    c.st["base"] = base
    source, report, _ = buildchecks.Gate(quick=False).run(c)
    ends = ticket_ends(c, items, base)
    if source:
        culprit = blame_gate(c, ends, base, home)
        if culprit is None:
            raise Stop("the full gate fails at the checkpoint of %s, and no deferred ticket's commit was found to "
                       "blame: %s" % (c.feature, (report.strip().splitlines() or [""])[-1]))
        reopen(c, culprit, source, "the full gate failed at the checkpoint after this ticket (it passed before "
               "it), so this ticket broke it. fix it on top of the code as it is now.\n\n" + report)
        return REOPENED
    for item in ends:
        num, start, path, _ = item
        if path is None:
            continue
        c.st.update({"ticket": path, "num": num, "base": start, "due_checks": ""})
        failed, report, _ = buildchecks.DoneWhen().run(c)
        if failed:
            reopen(c, item, failed, "its Done when checks failed at the checkpoint, with every ticket since the "
                   "last one built.\n\n" + report)
            return REOPENED
        c.write_due("%s (left for later)" % tickets.name(path))
    c.all.update({"num": "all", "ticket": "", "base": base, "checkpoint_sha": git.head(), "checkpoint_wait": ""})
    c.save()
    c.log("CHECKPOINT-PASS")
    return PASSED
