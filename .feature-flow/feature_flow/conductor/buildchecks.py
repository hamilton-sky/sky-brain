"""The checks of a build as an ordered pipeline: the gate, the floor guard, the footprint, Done when and test first.

Each check's `run(c)` takes the conductor (for its paths, settings, state and log) and returns
(failure source, report, notes): source is None when it passes, and the notes are for the reviewer.
`run` stops at the first failure. `pipeline` picks the checks of a build as the conductor always has:
the gate only with the gate on (a batch leaves it out: its gate runs once at HEAD), Done when and test
first only with the gate on. A checkpointed gate leaves the full gate and Done when to the checkpoint.
"""

import json
import re

from feature_flow import checks, git, lanes, proof, tickets
from feature_flow.conductor.errors import Stop
from feature_flow.conductor.store import NOTE_SEP


def _folder(c):
    """The folder c's checks run in (a Workspace's folder); None: the working folder."""
    return getattr(c, "folder", None)


def _at(c, path):
    """path under c's folder, for a file read; unchanged without a folder."""
    return path if _folder(c) is None or path.is_absolute() else _folder(c) / path


class Gate:
    def __init__(self, quick=None):
        self.quick = quick  # None: as c.gate_quick() says; True or False: always that

    def run(self, c):
        quick = c.gate_quick() if self.quick is None else self.quick
        changed = git.diff_names(c.get("base"), "HEAD", c.plan.as_posix(), cwd=_folder(c)) if c.get("base") else None
        result = checks.gate(c.scripts, c.feature, c.gate_timeout, quick=quick, cwd=_folder(c), changed=changed,
                             log=c.log)
        c.log("GATE-QUICK" if quick else "GATE-FULL")
        c.log("GATE-PASS" if result.ok else "GATE-FAIL")
        if not result.ok:
            return "gate (quick)" if quick else "gate (full)", result.out, []
        # what passed, so a Done when check that only runs one of these again is not run a second time
        c.gate_passed = (git.head(cwd=_folder(c)), set(re.findall(r"^gate: \w+: (.+)$", result.out, re.MULTILINE)))
        return None, "", []


class FloorGuard:
    def run(self, c):
        result = checks.floor_guard(c.scripts, c.feature, c.get("num"), c.get("base"), cwd=_folder(c))
        c.log("GUARD-PASS" if result.ok else "GUARD-FAIL")
        if not result.ok:
            return "floor guard", result.out, []
        warnings = [l for l in result.out.splitlines() if l.startswith("warning:")]
        return None, "", warnings[:1]


EXTRA = re.compile(r"^Extra file:[ \t]*`?([^`\s]+)`?[ \t]*[-—:][ \t]*(\S.*)$", re.MULTILINE)


class Footprint:
    """The paths the build changed outside the ticket's `Touches:` line (read at base), as a report for the
    builder. Passes when they are all inside it or the ticket has no such line. One ticket at a time (no lane, no
    batch), it also passes one path outside that the builder named in the Answer with a reason, `Extra file: <path>
    - <why>`; the reviewer is told to judge it."""

    def run(self, c):
        patterns = lanes.touches(c.ticket_at_base())
        changed = git.diff_names(c.get("base"), "HEAD", c.plan.as_posix(), cwd=_folder(c))
        c.log("CHANGED %s" % json.dumps(sorted(changed)[:200]))  # plan vs reality (feature_flow/reality.py) reads it
        if patterns is None:
            return None, "", []
        outside = [p for p in changed if not tickets.matches_sensitive(p, patterns)]
        declared = {}
        if len(outside) == 1 and not getattr(c, "lane", 0) and not c.fast():
            try:
                answer = c.at(c.ticket()).read_text(encoding="utf-8").split("\n## Answer", 1)[1:]
            except OSError:
                answer = []
            declared = {path: why for path, why in EXTRA.findall("".join(answer))}
        if len(outside) == 1 and outside[0] in declared:
            c.log("FOOTPRINT-EXTRA")
            return None, "", ["the build changed one file outside the ticket's Touches line, and the builder named it "
                              "with a reason: `%s` (%s). judge whether the ticket really needed it; if not, that is a "
                              "finding" % (outside[0], declared[outside[0]].strip())]
        c.log("FOOTPRINT-FAIL" if outside else "FOOTPRINT-PASS")
        if not outside:
            return None, "", []
        return "footprint check", (
            "the build changed paths outside the ticket's `Touches:` line (%s): %s. tickets run side by side "
            "because their Touches do not overlap, so change only what Touches names. if the ticket cannot be done "
            "inside it, say so in the Answer and stop: the plan has to change, not the footprint. one file the ticket truly needs "
            "(a test that pins the old behaviour, a generator) may be named in the Answer as `Extra file: <path> - "
            "<why>`, when it is the only one"
            % (" ".join(patterns) or "empty", ", ".join(outside[:20]))), []


class DoneWhen:
    """Run the ticket's check block. Sets c.checks_ran, and the due_checks key when checks are deferred."""

    def run(self, c):
        try:
            found = proof.checks_in(c.ticket_at_base())
        except proof.ParseError as err:
            raise Stop("%s has a check block the conductor cannot read: %s" % (c.ticket_name(), err))
        c.checks_ran = bool(found)
        if not found:
            c.log("DONEWHEN-SKIP")
            return None, "", ["the conductor ran no Done when checks: the ticket has no check block"]
        head, passed = getattr(c, "gate_passed", ("", set()))
        same = []
        if passed and head == git.head(cwd=_folder(c)):
            same = [x for x in found if x.command.strip() in passed and x.exit == 0 and not x.prints and not x.needs]
        found = [x for x in found if x not in same]
        if same:
            c.log("DONEWHEN-GATE %d" % len(same))
        met = (["%d Done when check(s) only run what the gate just passed at this commit, so the conductor did not run "
                "them again: %s. count them as MET (conductor)" % (len(same), "; ".join("`%s`" % x.command for x in same))]
               if same else [])
        if not found:
            return None, "", met
        deferred = []
        ok, report = proof.run_checks(found, c.gate_timeout, deferred, cwd=_folder(c))
        dirty = git.changes(cwd=_folder(c))
        if dirty:
            raise Stop("a Done when check of %s changed the working tree: %s. a check command must not change it"
                       % (c.ticket_name(), " ".join(dirty[:5])))
        c.log("DONEWHEN-PASS" if ok else "DONEWHEN-FAIL")
        if not ok:
            return "done when", report, []
        if not deferred:
            return None, "", met + ["the conductor ran %d Done when check(s) and all passed" % len(found)]
        c.log("DONEWHEN-DEFERRED %d" % len(deferred))
        c.st["due_checks"] = NOTE_SEP.join("deferred check, needs %s: `%s` (here: %s)" % (d.needs, d.command, got)
                                           for d, got in deferred)
        return None, "", met + [
            "the conductor ran %d Done when check(s): %d passed, and %d that need what this host lacks did "
            "not pass and are deferred, not met: %s. they go to the plan's followups.md. judge only what "
            "can be checked here, and mark each deferred check DEFERRED (conductor), never NOT MET"
            % (len(found), len(found) - len(deferred), len(deferred),
               "; ".join("`%s` (needs %s)" % (d.command, d.needs) for d, _ in deferred))]


class TestFirst:
    """For a `Test first: yes` ticket, prove a test-only commit failed the Test command. The branch to go
    back to is saved under the restore key while HEAD is detached. With a `Quick:` line it tries Quick first,
    which only has to see the new test fail, and runs the whole Test command only when Quick does not."""

    def run(self, c):
        if not proof.wants_test_first(c.ticket_at_base()):
            return None, "", []
        test = tickets.commands_value(_at(c, c.commands), "Test")
        if not test:
            c.log("TESTFIRST-SKIP")
            return None, "", ["the conductor did not check test first: commands.md has no Test command"]

        def remember(value):
            c.st["restore"] = value
            c.save()
        quick = tickets.commands_value(_at(c, c.commands), "Quick")
        try:
            ok, text = False, ""
            if quick:
                ok, text = proof.test_first(c.get("base"), quick, _at(c, c.plan), c.gate_timeout, remember)
                if ok:
                    text = text.replace("the Test command", "the Quick command")
            if not ok:
                ok, text = proof.test_first(c.get("base"), test, _at(c, c.plan), c.gate_timeout, remember)
        except proof.GitError as err:
            raise Stop("test first check of %s: %s" % (c.ticket_name(), err))
        c.log("TESTFIRST-PASS" if ok else "TESTFIRST-FAIL")
        if not ok:
            return "test first", text, []
        return None, "", [text] if text else []


def pipeline(c, gate=True):
    """The checks of a build, in order. gate=False leaves the gate out, as a batch does. At a checkpointed gate
    (`Gate: batch N` or `end`) a ticket gets only the cheap ones: the gate with Quick in the place of Test (none
    without a Quick command), the floor guard, the footprint and test first. The full gate and the Done when checks
    run at the checkpoint."""
    if c.checkpointing():
        found = [Gate(quick=True)] if gate and c.has_quick() else []
        return found + [FloorGuard(), Footprint(), TestFirst()]
    found = [Gate()] if gate and c.gate_on else []
    found += [FloorGuard(), Footprint()]
    if c.gate_on:
        found += [DoneWhen(), TestFirst()]
    return found


def run(c, found):
    """Run the checks in order: (source, report, []) for the first one that fails, else
    (None, "", the notes for the reviewer)."""
    notes = []
    for check in found:
        source, report, more = check.run(c)
        if source:
            return source, report, []
        notes.extend(more)
    return None, "", notes
