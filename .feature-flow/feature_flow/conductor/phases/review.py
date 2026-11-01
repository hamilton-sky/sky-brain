"""The review of a ticket, in its spec, quality or single pass: handed out, its verdict recorded, then judged."""

import os
import re

from feature_flow import git, scouts, state
from feature_flow.conductor import guards
from feature_flow.conductor.errors import NoPhase, Stop
from feature_flow.conductor.phases import ask as ask_phase
from feature_flow.conductor.phases.base import Outcome, Phase, read_reply, review_notes, ticket_prompt
from feature_flow.conductor.policy import levels, review
from feature_flow.conductor.policy.review import FINDING
from feature_flow.conductor.replies import SECOND, VERDICT, section_after
from feature_flow.conductor.store import NOTE_SEP

LEVEL_LINE = re.compile(r"^LEVEL: ([123])[ \t\r\f\v]*$")  # a reviewer raising the ticket's level


def take_verdict(ws, what):
    """The verdict `verdict` recorded, cleared; a pass keeps its minor findings for the follow-ups.
    With none recorded, nothing changes: the session must run verdict first. what names the review's subject."""
    verdict = ws.get("verdict")
    if not verdict:
        raise NoPhase("no verdict recorded for the review of %s: save the reviewer's whole reply to a file and "
                      "run verdict <that file>%s, then next" % (what, ws.lane_word()))
    if verdict == "pass":
        ws.add_due("due_minors", ws.get("reply_minors").split(NOTE_SEP))
    ws.st["verdict"] = ws.st["reply_minors"] = ""
    return verdict


def pair_verdict(found):
    """The one verdict of a pair review's two: a question wins, then a FAIL; PASS only when both passed; "" when the
    file does not hold both replies."""
    if len(found) < 2:
        return ""
    for word in found:
        if word.startswith("ask"):
            return word
    return "fail" if "fail" in found else "pass"


def record_verdict(ws, reply, final=False):
    """Record a reviewer's reply: its verdict, a raised level, a question, the findings or the minors. final is
    the feature review, which has no ticket level to raise and no ticket to pause for a question. A pair review's
    file holds both reviewers' replies, one after the other."""
    text = read_reply(reply)
    found = ""
    every = []
    asked = 0
    for line in text.splitlines():
        match = VERDICT.match(line)
        if match:
            found = match.group(1).lower()
            every.append(found)
        match = LEVEL_LINE.match(line)
        if match:
            asked = max(asked, int(match.group(1)))
    if not final and ws.get("review_pass") == "pair":
        found = pair_verdict(every)
    level = ws.num("level")
    if final:
        asked = 0  # the feature review has no ticket level to raise
    if asked > (level or 2):  # a ticket without a Level line already gets level 2 reviews or more
        ws.st["level"] = asked
        ws.st["level_note"] = levels.describe(asked, "a reviewer raised it")
        ws.st["level_raised"] = "1" if asked == 3 else ""
        notes = [n for n in ws.get("review_notes").split(NOTE_SEP) if n and not n.startswith("this ticket is level")]
        ws.st["review_notes"] = NOTE_SEP.join([ws.st["level_note"]] + notes)
        ws.log("LEVEL-RAISE")
    if found.startswith("ask"):
        role = found.split()[1]
        question = section_after(text, "## Question") or "\n".join(text.splitlines()[-40:])
        if final:  # no ticket to pause: the fix ticket's builder asks
            found = "fail"
            text = ("The feature reviewer could not judge this without an answer from the %s:\n\n%s\n\nAsk it in "
                    "this ticket with `## Ask: %s`." % (role, question, role))
        else:
            state.write_text(ask_phase.Ask.ask_file(ws, "question"), question + "\n")
            found = "ask:" + role
    if found == "fail":
        state.write_text(ws.findings_file, "\n".join(text.splitlines()[:120]) + "\n", "findings")
    if found == "pass":
        source = "feature review" if final else "%s review" % ws.get("review_pass", "spec")
        ws.st["reply_minors"] = NOTE_SEP.join("%s (%s)" % (" ".join(line.split()), source)
                                              for line in text.splitlines() if FINDING.match(line))
    ws.st["verdict"] = found or "none"
    ws.save()
    ws.log("VERDICT-%s" % (found or "none").upper())
    return "OK" if found else "RETRY no review verdict"


class Review(Phase):
    name = "review"

    @classmethod
    def hand_out(cls, ws):
        ws.count_run()
        ws.st["phase"] = "review"
        ws.st["review_pass"] = ws.get("review_pass") or "spec"
        ws.st["review_attempt"] = ws.num("review_attempt") + 1
        ws.st["review_sha"] = git.head(cwd=ws.folder)
        guards.mark_relay(ws, ws.st)
        ws.save()
        pair = " pair" if ws.get("review_pass") == "pair" and not ws.lane else ""
        return ws.emit("REVIEW %s %s %s%s%s" % (ws.ticket(), ws.get("num"), ws.get("base"), ws.lane_word(), pair))

    @classmethod
    def judge(cls, ws):
        ws.check_code()
        note = ws.undo_edit(ws.get("review_sha"), "reviewer", "a reviewer")
        if note:
            ws.edit_retry(note, ws.num("review_attempt"), "the reviewer of %s kept changing files" % ws.ticket_name())
            return Outcome(cls.hand_out(ws))
        ws.st["edit_note"] = ""
        verdict = take_verdict(ws, ws.ticket_name())
        review_pass = ws.get("review_pass", "spec")
        raised = review_pass == "single" and ws.get("level_raised") == "1"  # a reviewer raised it to 3 in this pass
        ws.st["level_raised"] = ""
        if verdict == "pass" and (review_pass == "spec" or raised):
            ws.st["review_pass"] = "quality"
            ws.st["review_attempt"] = 0
            ws.st["spec_ok"] = "1"
            return Outcome(cls.hand_out(ws))
        if verdict == "pass":
            return Outcome(ws.pass_ticket(), True)
        if verdict.startswith("ask:"):
            return Outcome(ask_phase.Ask.hand_out(ws, "review", verdict[4:],
                                                  state.read_text(ask_phase.Ask.ask_file(ws, "question")) or ""))
        if verdict == "fail":
            if ws.lane and ws.get("findings_for") != str(ws.lane):
                raise Stop("the review findings on file are not lane %d's: run verdict for this lane, then next %d"
                           % (ws.lane, ws.lane))
            findings = state.read_text(ws.findings_file, "findings") or ""
            source = {"quality": "quality review", "single": "single review",
                      "pair": "pair review"}.get(review_pass, "spec review")
            if review.on_fail(ws.num("level"), ws.num("round"), review_pass, findings) == "followups":
                return Outcome(ws.pass_with_followups(source, findings), True)
            return Outcome(ws.send_back(source, findings))
        if ws.num("review_attempt") >= ws.max_retries:
            raise Stop("no review verdict for %s after %d attempt(s)" % (ws.ticket_name(), ws.max_retries))
        return Outcome(cls.hand_out(ws))

    @classmethod
    def prompt(cls, ws):
        word = "review"
        if ws.get("review_pass") == "pair":
            notes = review_notes(ws)
            return (ticket_prompt(ws, "review-quality", notes + [
                        "a second reviewer checks the ticket's Done when and scope at the same time: do the quality "
                        "review only" + (", and probe the change as a hostile caller, as the guide says for level 3"
                                         if ws.num("level") == 3 else "")])
                    + "\n%s\n\n" % SECOND
                    + ticket_prompt(ws, "review", notes + [
                        "a second reviewer checks the code's quality at the same time: do the spec checklist only"]))
        if ws.get("review_pass") in ("quality", "single"):
            word = "review-" + ws.get("review_pass")
        return ticket_prompt(ws, word, review_notes(ws))

    @classmethod
    def record(cls, ws, reply):
        return record_verdict(ws, reply)

    @classmethod
    def scout_questions(cls, ws):
        """A level 3 ticket's first review, never in a later round or after a question."""
        if not ws.scouts_on or ws.num("round") or ws.num("asks"):
            return []
        if ws.num("level") == 3 and ws.get("review_pass") in ("spec", "single", "pair") and ws.num("review_attempt") == 1:
            tasks = "%s/%s" % (ws.plan.as_posix(), os.environ.get("FLOW_TICKETS") or "tasks")
            return scouts.review(ws.get("base"), tasks)
        return []
