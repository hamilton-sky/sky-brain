"""The ticket's level and the reason it was raised: from the ticket text before the build, from the diff after it.
Pure: the caller reads the ticket, the diff and the flow-edit flag, and saves and logs the result."""

from __future__ import annotations

import re

from feature_flow.proof import declared_level, review_mode

CONVERT = re.compile(r"^Type:[ \t]*convert\b", re.IGNORECASE | re.MULTILINE)
LEVEL_NAMES = {1: "light", 2: "standard", 3: "boundary"}


def declared(text, flow_edit):
    """(level, why) from the ticket text: its `Level:` line, raised to 3 by `Review: full`, `Type: convert` or
    flow_edit (the caller's reading of `Floor: allow flow-edit`). 0 when none of these is there; why is "" when
    the level was not raised."""
    level = declared_level(text)
    why = ""
    if level < 3:
        if review_mode(text) == "full":
            why = "the ticket says Review: full"
        elif CONVERT.search(text.split("\n## ", 1)[0]):
            why = "the ticket is Type: convert"
        elif flow_edit:
            why = "the ticket edits the flow's own code (Floor: allow flow-edit)"
    if why:
        level = 3
    return level, why


def measured(level, sensitive_hits, files, lines, binary, small_files, small_lines):
    """(level, why) raised from the built diff, never lowered: a path on commands.md's `Sensitive:` line makes it 3,
    and a level 1 diff over the small limits (or with a binary file) makes it 2. why is "" when not raised."""
    why = ""
    if sensitive_hits and level < 3:
        level, why = 3, "the diff touches a Sensitive path in commands.md: %s" % ", ".join(sensitive_hits[:3])
    if level == 1 and (binary or files > small_files or lines > small_lines):
        level, why = 2, "the diff (%d files, %d lines%s) is over the small limits" % (
            files, lines, ", a binary file" if binary else "")
    return level, why


def describe(level, why=""):
    return "this ticket is level %d (%s)%s" % (level, LEVEL_NAMES[level], ", raised because " + why if why else "")
