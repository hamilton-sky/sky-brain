"""One ticket at a time: hand out the lowest ready ticket, and end through the shared end of run."""

from feature_flow import checks, floorguard, git, lanes, tickets
from feature_flow.conductor import checkpoint, guards
from feature_flow.conductor.errors import Stop
from feature_flow.conductor.phases.build import Build
from feature_flow.conductor.phases.final import Final
from feature_flow.conductor.policy import levels
from feature_flow.conductor.schedulers.end import EndOfRun


class SerialScheduler:
    """The scheduler protocol: next(lane) is the next line when no phase is pending, on_passed(ws) counts a ticket
    whose phase passed it, resume() is the next line after the tester or the feature review."""

    lanes = False

    def __init__(self, c):
        self.c = c
        self.end = EndOfRun(c, self, lanes=self.lanes)

    def next(self, lane=None):
        return self.pick_ticket()

    def on_passed(self, ws):
        ws.st["phase"] = ""
        ws.st["done"] = ws.num("done") + 1
        ws.st["session_done"] = ws.num("session_done") + 1
        ws.save()
        return self.resume()

    def resume(self):
        return self.next(None)

    def put_back(self):
        """Check out what the test first check or a batch's judging left to go back to, before next goes on."""
        c = self.c
        if c.get("restore"):
            try:
                git._git("checkout", "-q", c.get("restore"))
            except RuntimeError as err:
                raise Stop("cannot put the working copy back after the test first check: %s. run `git checkout %s` "
                           "by hand" % (err, c.get("restore")))
            c.all["restore"] = ""
            c.save()
        if c.get("batch_restore"):
            try:
                git._git("checkout", "-q", c.get("batch_restore"))
            except RuntimeError as err:
                raise Stop("cannot go back to %s after judging a batch: %s. run `git checkout %s` by hand"
                           % (c.get("batch_restore"), err, c.get("batch_restore")))
            c.all["batch_restore"] = ""
            c.save()

    def pick_ticket(self):
        """Hand out the next ready ticket, or finish."""
        c = self.c
        check = checks.flow_status(c.scripts, c.feature, "--check")
        if not check.ok:
            raise Stop("ticket check failed, fix the tickets first")
        dirty = git.changes()
        if dirty:
            raise Stop("working tree is not clean, commit or stash first: %s%s"
                       % (" ".join(dirty[:5]), " and %d more" % (len(dirty) - 5) if len(dirty) > 5 else ""))
        if checkpoint.due(c) and checkpoint.run(c) == checkpoint.PASSED:  # every N tickets: gate and review them
            return Final.hand_out(c)
        nxt = checks.flow_status(c.scripts, c.feature, "--next")
        if nxt.code == 0:
            guards.before_ticket(c, only=("base",))  # before the tester too: its tests are judged by the gate
        line = self.end.tester()
        if line is not None:
            return line
        if nxt.code == 10:
            return self.end.finish()
        if nxt.code == 11:
            raise Stop("stuck: unfinished tickets remain but none is ready. run: python3 scripts/flow-status.py %s"
                       % c.feature)
        if nxt.code != 0:
            raise Stop("flow-status.py failed with exit code %d" % nxt.code)
        line = guards.before_ticket(c)
        if line is not None:
            return line
        return self.begin(nxt.out.strip().splitlines()[-1])

    def begin(self, first):
        """Start the ticket at first and hand out its build."""
        self.start_ticket(first)
        return Build.hand_out(self.c)

    def start_ticket(self, path, ws=None):
        """Fresh per-ticket state for the ticket at path, based at HEAD, in ws (the main worktree when None), then
        the smoke test."""
        c = ws if ws is not None else self.c
        c.st["limit"] = c.run_limit()
        c.st.update({"ticket": path, "num": tickets.number(path), "base": git.head(cwd=c.folder), "phase": "",
                     "attempt": 0, "review_attempt": 0, "round": 0, "check_rounds": 0, "review_rounds": 0, "review_sha": "", "review_notes": "", "review_pass": "spec",
                     "spec_ok": "", "level_note": "", "level_raised": "", "edit_note": "", "due_checks": "", "due_minors": "", "asks": 0, "ask_role": "", "ask_from": "",
                     "ticket_clock": c.all.get("spent", 0)})
        c.st["level"] = c.base_level()
        c.snapshot_code()
        guards.before_ticket(c, stage="start")

    def footprint(self, path):
        """(Touches patterns or None, level) of the ticket at path, read at HEAD of the main worktree: what
        decides whether it may run beside another (a lane) or with another (a batch). The level is raised to 3
        as base_level raises it."""
        text = self.c.show_head(path)
        level, _ = levels.declared(text, "flow-edit" in floorguard.allow_line(text).split())
        return lanes.touches(text), level
