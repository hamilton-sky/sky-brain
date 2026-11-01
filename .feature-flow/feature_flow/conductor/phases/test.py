"""The tester: writes the acceptance tests from spec.md before the build, or fixes the ones the product owner
ruled wrong. It is no ticket's phase and has no lane; the conductor judges its tests itself."""

from feature_flow import checks, gate, git, prompts
from feature_flow.conductor import guards
from feature_flow.conductor.errors import NoPhase, Stop
from feature_flow.conductor.phases.base import Outcome, Phase
from feature_flow.conductor.store import NOTE_SEP


class Test(Phase):
    name = "test"
    lane_scoped = False
    who = "tester"
    takes_verdict = False

    @classmethod
    def hand_out(cls, ws, retry=False):
        """Hand the tester its task: write the acceptance tests, or (with rulings) fix the ones the product owner
        ruled wrong. Like the feature review, it is no ticket's phase and has no lane."""
        ws.count_run()
        if not retry:
            ws.all.update({"test_base": git.head(), "test_attempt": 0, "test_note": "",
                           "test_mode": "fix" if ws.all.get("accept_rulings") else "write"})
        ws.all.update({"phase": "test", "num": "accept", "ticket": ""})
        ws.all["test_attempt"] = ws.num_all("test_attempt") + 1
        guards.mark_relay(ws, ws.all)
        ws.snapshot_code()
        ws.save()
        return ws.emit("TEST %s %s" % (ws.plan.as_posix(), ws.all["test_base"]))

    @classmethod
    def judge(cls, ws):
        """The tester's commits may change only the acceptance folder. The Test command must still pass with them
        in place, and newly written tests must fail before anything is built."""
        ws.check_code()
        base = ws.all.get("test_base", "")
        if not git.is_clean():
            raise Stop("working tree is dirty after the tester of %s: its tests should have been committed" % ws.feature)
        folder = ws.scheduler().end.acceptance_folder()
        changed = [p for p in git._git("diff", "--name-only", "--no-renames", base, "HEAD").stdout.splitlines() if p.strip()]
        outside = [p for p in changed if not p.startswith(folder)]
        if outside:
            raise Stop("the tester of %s changed %s, outside %s, where only its acceptance tests may go. take its "
                       "commits out with `git reset --hard %s` and run next to hand the tests out again"
                       % (ws.feature, ", ".join(outside[:5]), folder, base[:12]))
        note = ""
        if not changed:
            note = "the last tester committed nothing under %s" % folder
        elif ws.gate_on:
            result = checks.gate(ws.scripts, ws.feature, ws.gate_timeout)
            ws.log("TEST-GATE-PASS" if result.ok else "TEST-GATE-FAIL")
            if not result.ok:
                note = ("with the acceptance tests committed, the gate fails. keep them where only the Acceptance "
                        "command runs them, never in what commands.md's Test command runs. the last lines: %s"
                        % " ".join(gate.tail(result.out, 15).split())[:1200])
        if not note and ws.all.get("test_mode") != "fix":
            result = ws.scheduler().end.run_acceptance()
            if result.ok:
                note = ("the acceptance tests pass before anything is built, so they cannot fail. each one must fail "
                        "now, on an assertion about what spec.md promises, and pass once the feature is built")
        if note:
            if ws.num_all("test_attempt") >= ws.max_retries:
                raise Stop("the tester of %s did not finish after %d attempt(s): %s"
                           % (ws.feature, ws.num_all("test_attempt"), note))
            ws.all["test_note"] = note
            return Outcome(cls.hand_out(ws, retry=True))
        ws.log("TEST-FIXED" if ws.all.get("test_mode") == "fix" else "TEST-WRITTEN")
        for key in ("phase", "test_base", "test_attempt", "test_note", "test_mode", "accept_rulings", "accept_sha"):
            ws.all[key] = ""
        ws.save()
        return Outcome(ws.scheduler().resume())

    @classmethod
    def prompt(cls, ws):
        rulings = [r for r in ws.all.get("accept_rulings", "").split(NOTE_SEP) if r]
        end = ws.scheduler().end
        try:
            return prompts.tester(ws.scripts, ws.feature, ws.plan.as_posix(), ws.all.get("test_base", ""),
                                  end.acceptance_command(), end.acceptance_folder(),
                                  rulings if ws.all.get("test_mode") == "fix" else (),
                                  [n for n in (ws.all.get("test_note", ""),) if n], ws.prompts_top)
        except FileNotFoundError as err:
            raise Stop(str(err))

    @classmethod
    def record(cls, ws, reply):
        raise NoPhase("the tester has no verdict: the conductor judges its tests itself. run next")

    @classmethod
    def scout_questions(cls, ws):
        raise NoPhase("no BUILD or REVIEW is pending for %s" % ws.feature)  # the tester gets no scouts
