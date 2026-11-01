"""What every phase shares: the Outcome of judging it, and the defaults of the phase protocol.

The `ws` a phase gets is a Workspace (workspace.py): the Conductor itself in the main worktree, or a lane's
Workspace. Phases read the state, the lane and the lane word from it, and call back into it for check_code,
count_run, save, log and emit.
"""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from feature_flow import lanes, prompts
from feature_flow.conductor.errors import NoPhase, Stop
from feature_flow.conductor.store import NOTE_SEP


@dataclass(frozen=True)
class Outcome:
    """What judging a phase gave: the next line (None when a lane ticket waits for its merge), and whether the
    judgement passed the ticket."""
    line: Optional[str]
    passed: bool = False


class Phase:
    """The phase protocol, with the defaults of a phase that has nothing to do. The registry maps the phase word
    to a subclass; a phase word missing from it (none) gets these defaults."""
    name = ""
    lane_scoped = True  # False for the run-wide phases, which have no lane
    who = ""  # what the "has no lane" STOPs call a run-wide phase
    takes_verdict = True  # False when `verdict` has nothing to record for the phase

    @classmethod
    def hand_out(cls, ws):
        raise NotImplementedError

    @classmethod
    def judge(cls, ws):
        raise NotImplementedError

    @classmethod
    def prompt(cls, ws):
        raise NoPhase("no BUILD or REVIEW is pending for %s" % ws.feature)

    @classmethod
    def record(cls, ws, reply):
        raise NoPhase("no review is pending for %s" % ws.feature)

    @classmethod
    def scout_questions(cls, ws):
        return []

    @classmethod
    def key(cls, ws):
        """Names the phase handed out last, so scout replies saved for one phase never reach another."""
        return "%s:%s:%s:%s:%s:%s:%s:%s" % (ws.get("phase"), ws.get("num"), ws.num("round"), ws.num("attempt"),
                                            ws.get("review_pass"), ws.num("review_attempt"), ws.num("asks"),
                                            ws.num("ask_attempt"))


def read_reply(reply):
    try:
        return Path(reply).read_text(encoding="utf-8", errors="replace")
    except OSError as err:
        raise Stop("cannot read the review reply %s: %s" % (reply, err.strerror))


def lane_runner(text, scripts):
    """prompts points `python3 scripts/` at the running scripts folder unless it is the working folder's own. A lane
    agent works in the lane's folder, which the conductor never changes to, so a lane's prompt text gets the same
    rewrite here that prompts gave it while the conductor worked in that folder."""
    base = Path(scripts).absolute().as_posix()
    return re.sub(r"python3 scripts/([\w.-]+)", lambda m: "python3 " + shlex.quote(base + "/" + m.group(1)), text)


def ticket_prompt(ws, word, notes=()):
    """The build or review prompt of the ticket: word is build, review, review-quality or review-single."""
    def build(notes, retry):
        return prompts.build(word, ws.scripts, ws.feature, ws.ticket(), ws.get("num"), ws.get("base"),
                             notes,
                             retry=retry,
                             workdir=(str(ws.folder.resolve()), lanes.branch(ws.feature, ws.get("num"))) if ws.lane else None,
                             top=ws.prompts_top)
    try:
        text = build(notes, ws.num("round") > 0 or ws.num("attempt") > 1)  # sent back, or an attempt left it unresolved
        if ws.lane:  # the role, the guide and the task get the rewrite; the notes and the debugging guide never did
            head = build((), False)[:-1]
            text = lane_runner(head, ws.scripts) + text[len(head):]
        return text + ws.scout_findings()
    except FileNotFoundError as err:
        raise Stop(str(err))


def review_notes(ws):
    return [n for n in ws.get("review_notes").split(NOTE_SEP) + [ws.get("edit_note")] if n]
