"""Reading an agent's reply: its verdict or answer line, and the text under a heading."""

import hashlib
import re

VERDICT = re.compile(r"^REVIEW: (PASS|FAIL|ASK (?:architect|designer|po|user))[ \t\r\f\v]*$")
ANSWER = re.compile(r"^ANSWER: (GIVEN|USER)[ \t\r\f\v]*$")  # the last line of a consultant's reply


def section_after(text, heading):
    """The text under the last line that is exactly heading, up to the next `## ` heading or a verdict line."""
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if line.strip() == heading]
    if not starts:
        return ""
    out = []
    for line in lines[starts[-1] + 1:]:
        if line.startswith("## ") or VERDICT.match(line) or ANSWER.match(line):
            break
        out.append(line)
    return "\n".join(out).strip("\n")


def demote(text):
    """text with its `## ` headings made `### `, so it cannot open a section of the ticket it is written into."""
    return re.sub(r"(?m)^## ", "### ", text)


SECOND = "=== SECOND REVIEWER ==="  # splits a pair review's prompt: the quality reviewer's, then the ticket reviewer's


def prompt_files(state_file, feature, lane, text):
    """Write each prompt in text (a pair review has two, split at SECOND) to a file beside the state file, and
    return one `PROMPT-FILE <path> <sha256>` line per file."""
    lines = []
    for k, part in enumerate(text.split("\n%s\n" % SECOND), 1):
        path = state_file.with_name("prompt-%s%s-%d.md" % (feature, "-L%s" % lane if lane else "", k))
        data = (part.strip("\n") + "\n").encode("utf-8")
        path.write_bytes(data)
        lines.append("PROMPT-FILE %s %s" % (path.resolve().as_posix(), hashlib.sha256(data).hexdigest()))
    return "\n".join(lines)
