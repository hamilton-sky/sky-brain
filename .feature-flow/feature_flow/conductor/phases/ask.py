"""A question from a builder or reviewer to the architect, designer or product owner (or to the user, which
stops the run): handed out, its answer recorded, then judged, and the build or review goes on with it."""

import re
import shlex

from feature_flow import git, proof, prompts, scouts, state, tickets
from feature_flow.conductor.errors import NoPhase, Stop
from feature_flow.conductor.phases import build as build_phase
from feature_flow.conductor.phases import review as review_phase
from feature_flow.conductor.phases.base import Outcome, Phase, lane_runner, read_reply
from feature_flow.conductor.replies import ANSWER, demote, section_after
from feature_flow.conductor.store import NOTE_SEP

ASK_HEADING = re.compile(r"^## Ask: (architect|designer|po|user)[ \t]*$", re.MULTILINE)  # a builder's question
MAX_ASKS = 2  # questions one ticket may send to a consultant before the next one goes to the user
RULING = re.compile(r"^RULING: (TEST|CODE) WRONG[ \t\r\f\v]*$")  # the product owner on a disputed acceptance test


class Ask(Phase):
    name = "ask"

    @classmethod
    def ask_file(cls, ws, kind):
        """The question or answer of the pending ask, in the state folder (one pair per lane)."""
        return ws.state_file.parent / ("ask-%s%s.%s" % (ws.feature, "-L%d" % ws.lane if ws.lane else "", kind))

    @classmethod
    def open_ask(cls, ws):
        """(role, question) of a `## Ask: <role>` section the builder appended to the ticket and nobody answered
        yet (no `## Consulted` section after it), else (None, "")."""
        try:
            text = ws.at(ws.ticket()).read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None, ""
        asks = list(ASK_HEADING.finditer(text))
        if not asks:
            return None, ""
        last = asks[-1]
        rest = text[last.end():]
        if re.search(r"^## Consulted\b", rest, re.MULTILINE):
            return None, ""
        return last.group(1), rest.split("\n## ", 1)[0].strip("\n")

    @classmethod
    def hand_out(cls, ws, source, role, question):
        """Pause the build or review and hand the question to its consultant. It is not a failed attempt. A
        question for the user goes to the product owner first, once per ticket: the user is kept for scope, cost
        and steps outside the project, which the product owner hands on. A question the product owner handed on,
        or one past MAX_ASKS, goes into the ticket as `## Ask: user` and stops the run."""
        routed = role == "user" and ws.get("user_routed") != ws.get("num") and ws.num("asks") < MAX_ASKS
        if routed:
            ws.st["user_routed"] = ws.get("num")
            ws.log("ASK-USER-TO-PO")
            role = "po"
        if role == "user" or ws.num("asks") >= MAX_ASKS:
            if role != "user":
                question = "(for the %s, but this ticket asked its consultants %d times already)\n\n%s" % (
                    role, MAX_ASKS, question)
            return cls.ask_user(ws, source, question)
        if source == "build":
            ws.st["attempt"] = ws.num("attempt") - 1
        else:
            ws.st["review_attempt"] = ws.num("review_attempt") - 1
        ws.count_run()
        state.write_text(cls.ask_file(ws, "question"), question.strip("\n") + "\n")
        state.remove(cls.ask_file(ws, "answer"))
        ws.st.update({"phase": "ask", "asks": ws.num("asks") + 1, "ask_role": role, "ask_from": source,
                      "ask_attempt": 1, "verdict": "", "ask_sha": git.head(cwd=ws.folder),
                      "ask_routed": "1" if routed else ""})
        ws.save()
        return cls.emit_ask(ws)

    @classmethod
    def disputes_tests(cls, ws):
        """True for a question from the builder of an acceptance fix ticket: it may dispute a tester's test."""
        return (ws.get("ask_from") == "build" and bool(ws.all.get("accept_num"))
                and ws.get("num") == ws.all.get("accept_num"))

    @classmethod
    def emit_ask(cls, ws):
        return ws.emit("ASK %s %s %s %s%s" % (ws.get("ask_role"), ws.ticket(), ws.get("num"), ws.get("base"),
                                              ws.lane_word()))

    @classmethod
    def ask_user(cls, ws, source, question):
        """Stop for the user. The question goes into the ticket as `## Ask: user` (once), which keeps the run
        stopped until the user answers under `## Consulted (user)`; the ticket is then built again."""
        role, _ = cls.open_ask(ws)
        if role != "user":
            tickets.append_section(ws.at(ws.ticket()), "Ask: user", demote(question))
            if source == "review":
                tickets.set_open(ws.at(ws.ticket()))
            if not git.commit_file(ws.ticket(), "chore(%s): %s question for the user" % (ws.feature, ws.get("num")),
                                   cwd=ws.folder):
                raise Stop("cannot commit the question to %s. this session must be allowed to run git commit"
                           % ws.ticket_name())
        ws.st.update({"phase": "build", "attempt": min(ws.num("attempt"), ws.max_retries - 1)})
        ws.save()
        where = " (in the lane folder %s)" % ws.folder.resolve() if ws.lane else ""
        raise Stop("%s asks you: %s. answer it at the end of %s%s under `## Consulted (user)`, commit, and run next%s"
                   % (ws.ticket_name(), " ".join(question.split())[:600], proof.repo_relative(ws.ticket(), cwd=ws.folder), where,
                      " %d" % ws.lane if ws.lane else ""))

    @classmethod
    def record(cls, ws, reply):
        return cls.record_answer(ws, read_reply(reply))

    @classmethod
    def record_answer(cls, ws, text):
        found = ""
        ruling = ""
        for line in text.splitlines():
            match = ANSWER.match(line)
            if match:
                found = match.group(1).lower()
            match = RULING.match(line)
            if match:
                ruling = match.group(1).lower()
        ws.st["ruling"] = ruling
        why = section_after(text, "## Why")
        state.write_text(cls.ask_file(ws, "why"), " ".join(why.split())[:600] + "\n")
        if found:
            answer = section_after(text, "## Answer") or "\n".join(l for l in text.splitlines() if not ANSWER.match(l))
            lines = [l for l in demote(answer).strip("\n").splitlines() if not RULING.match(l)]
            state.write_text(cls.ask_file(ws, "answer"), "\n".join(lines[:60]) + "\n")
        ws.st["verdict"] = found or "none"
        ws.save()
        ws.log("ANSWER-%s" % (found or "none").upper())
        return "OK" if found else "RETRY no answer"

    @classmethod
    def judge(cls, ws):
        ws.check_code()
        role = ws.get("ask_role")
        note = ws.undo_edit(ws.get("ask_sha"), role, "a consultant")
        if note:
            ws.edit_retry(note, ws.num("ask_attempt"), "the %s for %s kept changing files" % (role, ws.ticket_name()))
            verdict = "none"
        else:
            ws.st["edit_note"] = ""
            verdict = ws.get("verdict")
            if not verdict:
                raise NoPhase("no answer recorded from the %s for %s: save its whole reply to a file and run verdict "
                              "<that file>%s, then next" % (role, ws.ticket_name(), ws.lane_word()))
        ws.st["verdict"] = ""
        if verdict not in ("given", "user"):
            if ws.num("ask_attempt") >= ws.max_retries:
                raise Stop("no answer from the %s for %s after %d attempt(s)" % (role, ws.ticket_name(), ws.max_retries))
            ws.st["ask_attempt"] = ws.num("ask_attempt") + 1
            ws.count_run()
            ws.save()
            return Outcome(cls.emit_ask(ws))
        question = (state.read_text(cls.ask_file(ws, "question")) or "").strip("\n")
        answer = (state.read_text(cls.ask_file(ws, "answer")) or "").strip("\n")
        source = ws.get("ask_from")
        ws.log("ASK-%s-%s" % (role.upper(), verdict.upper()))
        if verdict == "user":
            return Outcome(cls.ask_user(ws, source, "%s\n\nThe %s says only you can decide. Its options:\n\n%s"
                                        % (question, role, answer)))
        if source == "review":
            ws.st["phase"] = "review"
            notes = [n for n in ws.get("review_notes").split(NOTE_SEP) if n]
            notes.append("you asked the %s: %s. the answer: %s" % (role, " ".join(question.split())[:400],
                                                                  " ".join(answer.split())[:1500]))
            ws.st["review_notes"] = NOTE_SEP.join(notes)
            return Outcome(review_phase.Review.hand_out(ws))
        ruling = ws.get("ruling")
        ws.st["ruling"] = ""
        if ruling and cls.disputes_tests(ws):
            ws.log("RULING-%s" % ruling.upper())
            if ruling == "test":
                ws.all["accept_rulings"] = NOTE_SEP.join(
                    [r for r in ws.all.get("accept_rulings", "").split(NOTE_SEP) if r]
                    + [" ".join(("%s THE PRODUCT OWNER: %s" % (question, answer)).split())[:2000]])
                answer += ("\n\nThe product owner ruled the test wrong: leave it failing and finish the rest. The tester "
                           "changes it once this ticket is resolved.")
        tickets.append_section(ws.at(ws.ticket()), "Consulted (%s)" % role,
                               "**Question:**\n\n%s\n\n**Answer:**\n\n%s" % (demote(question), answer))
        decisions = cls.log_decision(ws, role, question, answer)
        if not git.commit_paths([ws.ticket(), decisions], "chore(%s): %s answer from the %s"
                                % (ws.feature, ws.get("num"), role), cwd=ws.folder):
            raise Stop("cannot commit the %s's answer to %s. this session must be allowed to run git commit"
                       % (role, ws.ticket_name()))
        ws.st["phase"] = "build"
        return Outcome(build_phase.Build.hand_out(ws))

    @classmethod
    def log_decision(cls, ws, role, question, answer):
        """Append the question, who answered, the answer and why to the plan's decisions.md; its path. The user reads
        it to see what the agents decided for them."""
        path = ws.plan / "decisions.md"
        why = (state.read_text(cls.ask_file(ws, "why")) or "").strip() or "(the answer gave no reason)"
        asker = {"build": "builder", "review": "reviewer"}.get(ws.get("ask_from"), "builder")
        text = "" if ws.at(path).is_file() else (
            "# Decisions: %s\n\nQuestions the builders and reviewers asked during the run, and what the architect, "
            "designer or product owner decided, so nobody had to stop for the user. Read them: an answer you disagree "
            "with is a ticket to change.\n" % ws.feature)
        text += "\n## %s, asked by the %s, answered by the %s\n\n- **Question:** %s\n- **Answer:** %s\n- **Why:** %s\n" % (
            ws.ticket_name(), asker, role, " ".join(question.split())[:800], " ".join(answer.split())[:1500], why)
        with open(str(ws.at(path)), "a", encoding="utf-8") as handle:
            handle.write(text)
        ws.log("DECISION")
        return path

    @classmethod
    def prompt(cls, ws):
        role = ws.get("ask_role")
        question = (state.read_text(cls.ask_file(ws, "question")) or "").strip("\n")
        rel = proof.repo_relative(ws.ticket(), cwd=ws.folder)
        asker = {"build": "builder", "review": "reviewer"}.get(ws.get("ask_from"), "builder")
        task = ("Your question comes from the %s of ticket %s of the feature `%s`. Read the plan in `%s` (`spec.md`, "
                "`map.md`, and the mock-ups if there are any) and the ticket as it was planned, with `git show %s:%s`. "
                "The work started at commit `%s`.\n\nThe question:\n\n%s\n\nDo not edit any file or create a "
                "commit. Your final reply must end with exactly `ANSWER: GIVEN` or `ANSWER: USER`."
                % (asker, ws.get("num"), ws.feature, ws.plan.as_posix(), ws.get("base"), rel, ws.get("base"),
                   question))
        if role == "po" and cls.disputes_tests(ws):
            task += ("\n\nThe builder disputes an acceptance test. The tester wrote it from spec.md before the build, "
                     "without seeing the code. Rule on it from spec.md alone, not from what was built: put the line "
                     "`RULING: TEST WRONG` (the test asks for what spec.md does not say, and the tester changes it) or "
                     "`RULING: CODE WRONG` (the code must change to pass it) above your ANSWER line, and quote the "
                     "spec.md line you ruled by.")
        if ws.get("ask_routed") == "1":
            task += ("\n\nThe asker meant this question for the user. The user is kept for scope, cost and steps "
                     "outside the project, so answer it yourself when it is about what the feature must do or how it "
                     "behaves. End with `ANSWER: USER`, and the options in a sentence each, only when it is one of those "
                     "three.")
        if ws.get("edit_note"):
            task += "\n\nThe conductor notes: %s" % ws.get("edit_note")
        if ws.lane:
            task = ("Work in the folder `%s` (`cd %s` first): the worktree of this ticket. Every path here is relative "
                    "to it.\n\n%s" % (ws.folder.resolve(), shlex.quote(str(ws.folder.resolve())), task))
        try:
            role_text = prompts.role(ws.scripts, prompts.ROLES["ask-" + role], ws.prompts_top)
        except FileNotFoundError as err:
            raise Stop(str(err))
        if ws.lane:
            role_text = lane_runner(role_text, ws.scripts)
        return "%s\n\n---\n\n%s\n" % (role_text, task) + ws.scout_findings()

    @classmethod
    def scout_questions(cls, ws):
        """The consultants' first attempt at a question."""
        if not ws.scouts_on:
            return []
        question = (state.read_text(cls.ask_file(ws, "question")) or "").strip("\n")
        return scouts.consult(ws.get("ask_role"), question) if ws.num("ask_attempt") == 1 else []
