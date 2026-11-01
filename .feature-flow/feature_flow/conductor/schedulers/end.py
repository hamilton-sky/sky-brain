"""The end of a run, shared by every scheduler: acceptance tests due (the tester), the acceptance run, the
feature review for deferred tickets, and the DONE line."""

import os

from feature_flow import checks, gate, git, lanes, proof, tickets
from feature_flow.conductor import checkpoint
from feature_flow.conductor.errors import Stop
from feature_flow.conductor.phases.final import Final
from feature_flow.conductor.phases.test import Test


class EndOfRun:
    def __init__(self, c, scheduler, lanes=False):
        self.c = c
        self.scheduler = scheduler  # resumes the run after a failed acceptance run became a fix ticket
        self.lanes = lanes  # a lane run removes its worktrees at DONE and clears only the run's owner

    # ---- the tester: acceptance tests written from spec.md before the build, run once every ticket is done --

    def acceptance_command(self):
        """commands.md's Acceptance command as committed, or "" when the plan has none: then there is no tester."""
        c = self.c
        return tickets.commands_text_value(c.show_head(c.commands), "Acceptance")

    def acceptance_folder(self):
        """Where the tester's tests live, relative to the repo, with a trailing slash. Inside the plan folder, so
        the floor guard already keeps every builder out of it."""
        return proof.repo_relative(self.c.plan / "acceptance").rstrip("/") + "/"

    def tests_due(self):
        """True when the plan has an Acceptance command and no acceptance tests are committed yet."""
        if not self.acceptance_command():
            return False
        listed = git._git("ls-tree", "-r", "--name-only", "HEAD", "--", self.acceptance_folder(), check=False)
        return listed.returncode == 0 and not listed.stdout.strip()

    def tester(self):
        """The tester's line when acceptance tests are due, else None."""
        return Test.hand_out(self.c) if self.tests_due() else None

    def run_acceptance(self):
        """Run the Acceptance command from the top of the repo. It must leave the working tree as it was."""
        c = self.c
        c.all["num"] = "accept"
        result = checks.smoke(self.acceptance_command(), c.gate_timeout)
        dirty = git.changes()
        if dirty:
            raise Stop("the Acceptance command of %s changed the working tree: %s. it must not change it"
                       % (c.feature, " ".join(dirty[:5])))
        return result

    def check_acceptance(self):
        """Every ticket is resolved: first the tests the product owner ruled wrong go back to the tester, then the
        acceptance tests run. A failure becomes a fix ticket. Returns the next line, or None when they pass (or the
        plan has no Acceptance command)."""
        c = self.c
        if not self.acceptance_command():
            return None
        if c.all.get("accept_rulings"):
            return Test.hand_out(c)
        head = git.head()
        if c.all.get("accept_sha") == head:
            return None
        result = self.run_acceptance()
        if result.ok:
            c.log("ACCEPT-PASS")
            c.all["accept_sha"] = head
            c.save()
            return None
        c.log("ACCEPT-FAIL")
        round_no = c.num_all("accept_round") + 1
        if round_no > c.max_rounds:
            raise Stop("the acceptance tests of %s still fail after %d round(s) of fixes. the user decides what happens "
                       "next: the last fix ticket says what failed" % (c.feature, c.max_rounds))
        path = self.acceptance_ticket(round_no, result)
        if not git.commit_file(path, "chore(%s): acceptance test fixes, round %d" % (c.feature, round_no)):
            raise Stop("cannot commit %s. this session must be allowed to run git commit" % path.as_posix())
        c.all.update({"accept_round": round_no, "accept_num": tickets.number(str(path)), "phase": ""})
        c.save()
        return self.scheduler.resume()

    def acceptance_ticket(self, round_no, result):
        """Write the failing acceptance run as a new open ticket, numbered after the last one."""
        c = self.c
        folder = c.plan / (os.environ.get("FLOW_TICKETS") or "tasks")
        nums = [int(tickets.number(p)) for p in tickets.ticket_files(str(folder)) if tickets.number(p).isdigit()]
        path = folder / ("%02d-acceptance-fixes-%d.md" % (max(nums or [0]) + 1, round_no))
        out = gate.tail(result.out + ("\nthe Acceptance command timed out after %d minutes\n" % c.gate_timeout
                                      if getattr(result, "timed_out", False) else ""), 60)
        quoted = "\n".join("    " + line for line in out.strip("\n").splitlines()) or "    (no output)"
        tests = self.acceptance_folder()
        path.write_text(
            "# Make the acceptance tests pass, round %d\n\n"
            "Type: task\nStatus: open\nBlocked by: —\nTest first: no\nLevel: 2\n"
            "Check: none the conductor runs the acceptance tests again once every ticket is resolved\n\n"
            "Every ticket is resolved, but the acceptance tests fail. The tester wrote them in `%s` from spec.md "
            "before the build, so they check what the product owner asked for, not how it was built. Fix the code "
            "so they pass. You may run them with `%s`.\n\n"
            "If you are sure a test asks for something spec.md does not say, do not work around it, and do not "
            "change the test: the floor guard fails any change under `%s`. Add a `## Ask: po` section to this ticket "
            "that names the test, what it expects and the spec.md line it disagrees with, and stop. The product owner "
            "rules on it. A test it rules wrong is left failing here and goes back to the tester once this ticket is "
            "resolved.\n\n"
            "## Not in this ticket\n\n- Any file under `%s`.\n\n"
            "## Done when\n\n- `%s` passes, apart from tests the product owner ruled wrong in this ticket.\n"
            "- commands.md's Test command passes.\n\n"
            "## The failing run\n\n%s\n\n## Answer\n"
            % (round_no, tests, self.acceptance_command(), tests, tests, self.acceptance_command(), quoted),
            encoding="utf-8")
        return path

    # ---- no ticket left -------------------------------------------------

    def finish(self):
        """Every ticket is resolved (and, with lanes, merged): the last checkpoint of a checkpointed gate, the
        acceptance run, then the feature review for the deferred tickets, then DONE. Serial runs check tests due before they ask for the next ticket, lane runs
        only when no lane is busy, so the tester is not part of this step."""
        c = self.c
        if checkpoint.due(c, at_end=True) and checkpoint.run(c) == checkpoint.REOPENED:
            return self.scheduler.resume()
        line = self.check_acceptance()
        if line is not None:
            return line
        if c.deferred() or Final.round_tickets(c):
            return Final.hand_out(c)
        if self.lanes:
            lanes.remove_all(c.top, c.feature)
        done = c.num("done")
        followups = c.num("followups")
        if self.lanes:
            c.all["owner"] = ""
        else:
            c.st["phase"] = ""
            c.st["owner"] = ""
        c.save()
        return c.emit("DONE %s is complete: %d ticket(s) resolved in this run%s" % (
            c.feature, done, "; %d passed with follow-ups in %s" % (followups, (c.plan / "followups.md").as_posix())
            if followups else ""))
