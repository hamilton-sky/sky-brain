"""The build of a ticket: handed to a builder, then judged by the check pipeline and the review policy."""

from feature_flow import checks, gate, git, lanes, prompts, proof, scouts, tickets
from feature_flow.conductor import buildchecks, guards
from feature_flow.conductor.errors import Stop
from feature_flow.conductor.phases import ask as ask_phase
from feature_flow.conductor.phases import review as review_phase
from feature_flow.conductor.phases.base import Outcome, Phase, ticket_prompt
from feature_flow.conductor.policy import review
from feature_flow.conductor.store import NOTE_SEP


class Build(Phase):
    name = "build"

    @classmethod
    def hand_out(cls, ws):
        ws.count_run()
        ws.st["phase"] = "build"
        ws.st["attempt"] = ws.num("attempt") + 1
        guards.mark_relay(ws, ws.st)
        ws.save()
        return ws.emit("BUILD %s %s %s%s" % (ws.ticket(), ws.get("num"), ws.get("base"), ws.lane_word()))

    @classmethod
    def judge(cls, ws):
        ws.check_code(ws.flow_edit_allowed())
        ws.log("CHECKS")  # the build ended: eval times the checks from here
        if ws.get("batch"):
            return Outcome(ws.scheduler().judge_batch())
        status = tickets.status(ws.at(ws.ticket()))
        if status not in tickets.DONE:
            if status in tickets.RESET:
                tickets.set_open(ws.at(ws.ticket()))
            role, question = ask_phase.Ask.open_ask(ws)
            if role:
                return Outcome(ask_phase.Ask.hand_out(ws, "build", role, question))
            if ws.num("attempt") >= ws.max_retries:
                raise Stop("%s is still unresolved after %d attempt(s)" % (ws.ticket_name(), ws.max_retries))
            return Outcome(cls.hand_out(ws))
        if not git.is_clean(cwd=ws.folder):
            raise Stop("working tree is dirty after %s, it should have been committed" % ws.ticket_name())
        source, report, notes = buildchecks.run(ws, buildchecks.pipeline(ws))
        if source:
            return Outcome(ws.send_back(source, report, kind="check"))
        level = ws.measure_level()
        if ws.checkpointing() and level >= 3:  # it keeps its own review, so the full gate and Done when run now too
            source, report, own = buildchecks.run(ws, [buildchecks.Gate(quick=False), buildchecks.DoneWhen()])
            if source:
                return Outcome(ws.send_back(source, report, kind="check"))
            notes += own
        decision, review_pass, more, events = review.after_checks(
            level, ws.fast(), ws.gate_on, ws.checks_ran, ws.small_note() if level == 0 else "",
            proof.review_mode(ws.ticket_at_base()), ws.get("spec_ok"), ws.num("round"), ws.get("level_note"),
            pair=ws.reviewers == 2 and not ws.lane, checkpoint=ws.checkpointing())
        if decision == "defer":
            return Outcome(ws.defer_review(), True)
        ws.st["review_pass"] = review_pass
        for event in events:
            if event == "REVIEW-SINGLE":
                ws.st["level_raised"] = ""
            ws.log(event)
        if review_pass == "pair":
            more += cls.acceptance_note(ws)
        ws.st["review_notes"] = NOTE_SEP.join(notes + more)
        return Outcome(review_phase.Review.hand_out(ws))

    @classmethod
    def acceptance_note(cls, ws):
        """With two reviewers: the tester's acceptance tests run after the ticket, so the ticket reviewer sees which
        ones its work should have turned green. [] when the plan has no acceptance tests yet."""
        end = ws.scheduler().end
        command = end.acceptance_command()
        if not command or end.tests_due():
            return []
        result = checks.smoke(command, ws.gate_timeout, cwd=ws.folder)
        dirty = git.changes(cwd=ws.folder)
        if dirty:
            raise Stop("the Acceptance command of %s changed the working tree: %s. it must not change it"
                       % (ws.feature, " ".join(dirty[:5])))
        ws.log("ACCEPT-TICKET-%s" % ("PASS" if result.ok else "FAIL"))
        return ["the conductor ran the acceptance tests (`%s`) after this ticket: they %s. tests for tickets not built "
                "yet may fail; a test for what this ticket delivers that fails is NOT MET. the last lines: %s"
                % (command, "pass" if result.ok else "fail",
                   " ".join(gate.tail(result.out, 20).split())[:1500])]

    @classmethod
    def prompt(cls, ws):
        if ws.get("batch"):
            try:
                return prompts.build("build", ws.scripts, ws.feature, ws.ticket(), ws.get("num"), ws.get("base"),
                                     top=ws.prompts_top, gate_on=bool(ws.gate_on)
                                     ) + "\n" + ws.scheduler().batch_note() + "\n" + ws.scout_findings()
            except FileNotFoundError as err:
                raise Stop(str(err))
        return ticket_prompt(ws, "build")

    @classmethod
    def scout_questions(cls, ws):
        """A build's first attempt above level 1 (or with no level), never in a later round or after a question.
        Deep code scouts ask as for one level higher: a level 1 ticket gets one, a level 2 ticket the boundary too."""
        if not ws.scouts_on or ws.num("round") or ws.num("asks") or ws.num("attempt") != 1:
            return []
        level = ws.num("level")
        if ws.settings.scout_code == "deep" and level in (1, 2):
            level += 1
        return scouts.build(proof.repo_relative(ws.ticket(), cwd=ws.folder), ws.get("base"), lanes.touches(ws.ticket_at_base()) or [],
                            level)
