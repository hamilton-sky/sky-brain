"""What happens after a build's checks pass and after a review fails. Pure: the caller reads the state and the
ticket, then saves, logs and hands out what these return."""

from __future__ import annotations

import re

FINDING = re.compile(r"^[ \t]*[0-9]+\.[ \t]+(blocker|major|minor)\b", re.IGNORECASE)
FULL_ROUNDS = 2  # a level 2 ticket's rounds in which a major finding still sends it back


def followups_only(findings):
    """True when a FAIL reply's only reasons are major or minor findings: no blocker, no NOT MET bullet,
    no missing test first and no scope problem. Such a level 2 ticket may pass with follow-ups."""
    severities = []
    for line in findings.splitlines():
        match = FINDING.match(line)
        if match:
            severities.append(match.group(1).lower())
        if "NOT MET" in line or re.match(r"^[ \t]*-[ \t]*test first:[ \t]*MISSING", line, re.IGNORECASE):
            return False
        scope = re.match(r"^[ \t]*-[ \t]*scope:[ \t]*(.*)$", line, re.IGNORECASE)
        if scope and scope.group(1).strip().upper() != "OK":
            return False
    return bool(severities) and "blocker" not in severities


def after_checks(level, fast, gate_on, checks_ran, small_note, review_mode, spec_ok, round_no, level_note, pair=False,
                 checkpoint=False):
    """(decision, review_pass, notes, events) for a build whose checks passed. decision is "defer" (fast mode or a
    checkpointed gate, below level 3 with the gate on: review it at the end or at the next checkpoint) or "review"; notes are the reviewer notes to add after the
    checks' own, in order; events the log events (REVIEW-SMALL, REVIEW-SINGLE, REVIEW-PAIR). With pair, a level 1 to
    3 ticket's one review becomes two reviewers side by side: quality, and the ticket's spec checklist."""
    if (fast or checkpoint) and level < 3 and gate_on:  # with the gate off, nothing but the review checks it
        return "defer", "", [], []
    review_pass = "spec"
    notes = []
    events = []
    if level == 0:
        if gate_on and checks_ran and small_note:
            review_pass = "single"
            events.append("REVIEW-SMALL")
            notes.append(small_note)
    else:
        notes.append(level_note)
        if review_mode != "full" and pair:
            review_pass = "pair"
            events.append("REVIEW-PAIR")
            if level < 3:
                notes.append("from the first round, only a blocker or a NOT MET bullet sends the ticket back: majors "
                             "and minors go to the plan's followups.md and the ticket passes")
        elif review_mode != "full":  # `Review: full` asks for both passes
            # at level 3 too: in the field a separate spec pass never caught what the conductor's checks had not
            review_pass = "single"
            events.append("REVIEW-SINGLE")
            notes.append("one review covers the spec and quality passes: do the spec checklist first" +
                         (", then probe the change as a hostile caller, as the guide says for level 3"
                          if level == 3 else ""))
    if review_pass == "spec" and spec_ok:
        review_pass = "quality"
        notes.append("the spec review passed in an earlier round, so this round has the quality review only")
    if level == 2 and round_no >= FULL_ROUNDS:
        notes.append("this is round %d: from now on only a blocker finding sends the ticket back. majors and "
                     "minors go to the plan's followups.md and the ticket passes" % (round_no + 1))
    return "review", review_pass, notes, events


def on_fail(level, round_no, review_pass, findings):
    """"followups" when a failed review lets the ticket pass with follow-ups (level 2, past FULL_ROUNDS, outside
    the spec pass, only major or minor findings; or a level 1 or 2 pair review with only those), else "send_back"."""
    if level == 2 and round_no >= FULL_ROUNDS and review_pass != "spec" and followups_only(findings):
        return "followups"
    if review_pass == "pair" and level in (1, 2) and followups_only(findings):  # two reviewers: blockers only
        return "followups"
    return "send_back"
