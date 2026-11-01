"""Reading and changing ticket files."""

import fnmatch
import os
import re
from pathlib import Path

DONE = ("resolved", "done", "closed")
RESET = ("claimed", "in-progress")


def name(path):
    return Path(path).stem


def number(path):
    return name(path).split("-", 1)[0]


def _lines(path):
    return Path(path).read_text(encoding="utf-8").splitlines(True)


def status(path):
    """The first word of the Status line in the first 20 lines, lower case."""
    for line in _lines(path)[:20]:
        if line.startswith("Status:"):
            value = line[len("Status:"):].strip().lower()
            return value.split()[0] if value else ""
    return ""


def set_open(path):
    lines = _lines(path)
    for i, line in enumerate(lines[:20]):
        if line.startswith("Status:"):
            lines[i] = "Status: open\n"
            break
    Path(path).write_text("".join(lines), encoding="utf-8")


def title(path):
    """The text of the ticket's `# ` title line, or ""."""
    for line in _lines(path)[:20]:
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def append_findings(path, round_no, source, findings):
    append_section(path, "Review findings (round %d, %s)" % (round_no, source), findings)


def append_section(path, heading, body):
    text = "\n## %s\n\n%s\n" % (heading, body.rstrip("\n"))
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(text)


def commands_value(path, key):
    """A command from commands.md, or "" when it is missing or a placeholder in angle brackets."""
    path = Path(path)
    if not path.is_file():
        return ""
    return commands_text_value(path.read_text(encoding="utf-8"), key)


def commands_text_value(text, key):
    """commands_value over the text of a commands.md, for a copy read from git."""
    for line in text.splitlines():
        if re.match(r"^%s:" % re.escape(key), line):
            value = re.sub(r"^%s:[ \t]*" % re.escape(key), "", line).replace("`", "")
            return "" if value.startswith("<") else value
    return ""


def sensitive_patterns(text):
    """The path patterns on the `Sensitive:` line of a commands.md text, split on commas and spaces."""
    return [p for p in re.split(r"[,\s]+", commands_text_value(text, "Sensitive")) if p]


def matches_sensitive(path, patterns):
    """True when the repo-relative path matches a pattern: `dir/` is that folder and everything under it,
    anything else is an fnmatch glob over the whole path (`*` crosses `/`)."""
    for pattern in patterns:
        pattern = pattern[2:] if pattern.startswith("./") else pattern
        if pattern.endswith("/"):
            if path.startswith(pattern):
                return True
        elif fnmatch.fnmatchcase(path, pattern):
            return True
    return False


# The ticket graph, read the way the bash flow-status script's awk program reads it.

STATUS_WORDS = {
    "resolved": "resolved", "done": "resolved", "closed": "resolved",
    "claimed": "claimed", "in-progress": "claimed",
    "parked": "parked", "wontfix": "parked",
    "needs-triage": "waiting", "needs-info": "waiting", "ready-for-human": "waiting", "waiting": "waiting",
    "open": "open", "ready-for-agent": "open",
}
_FILE_RE = re.compile(r"^[0-9][0-9].*-.*\.md$")
_MENTION_RE = re.compile(r"[Tt]ickets? +[0-9]+( *(,|and|&) *[0-9]+)*")
_DIGITS_RE = re.compile(r"[0-9]+")


def records(path):
    """The file's lines: split on \\n only, no final empty record, bytes kept. A trailing \\r is dropped,
    so a ticket saved with Windows line endings reads the same as one saved with \\n."""
    text = Path(path).read_bytes().decode("utf-8", "surrogateescape")
    if text == "":
        return []
    lines = text.split("\n")
    if text.endswith("\n"):
        lines.pop()
    return [line[:-1] if line.endswith("\r") else line for line in lines]


def ticket_files(folder):
    """What the glob [0-9][0-9]*-*.md finds in the folder, as folder/name, in name order."""
    folder = str(folder)
    try:
        names = sorted(n for n in os.listdir(folder) if _FILE_RE.match(n))
    except OSError:
        return []
    return ["%s/%s" % (folder, n) for n in names]


def norm_status(value):
    s = value.lower()
    s = re.sub(r"^[ \t]+", "", s)
    s = re.sub(r"[ \t(].*$", "", s, flags=re.S)
    return STATUS_WORDS.get(s, "unknown")


class Graph:
    """Every ticket in a folder, keyed by number. The fields follow the awk arrays one to one."""

    def __init__(self, paths):
        self.seen = set()
        self.dup = set()
        self.path, self.lab, self.stat, self.title = {}, {}, {}, {}
        self.hasstatus, self.hasdone, self.blk = {}, {}, {}
        self.hasblk, self.hastype, self.hastf, self.hastitle = set(), set(), set(), set()
        self.typ, self.tf = {}, {}
        self.hasreview, self.review = set(), {}
        self.hasbuilder, self.builder = set(), {}
        self.haslevel, self.level = set(), {}
        self.hastouches, self.touches = set(), {}
        self.mentions = {}
        for p in paths:
            self._read(p)
        self.order = sorted(self.seen)

    def _read(self, filename):
        lines = records(filename)
        if not lines:
            return  # awk never starts an empty file
        base = filename.rsplit("/", 1)[-1]
        label = re.match(r"^[0-9]+", base).group(0)
        cur = int(label)
        if cur in self.path:
            self.dup.add(cur)
        self.path[cur] = filename
        self.lab[cur] = label
        self.stat[cur] = "unknown"
        self.hasstatus[cur] = False
        self.hasdone[cur] = False
        self.blk[cur] = []
        self.title[cur] = base
        self.seen.add(cur)
        skipm = False
        ment = self.mentions.setdefault(cur, [])
        for fnr, line in enumerate(lines, 1):
            head = fnr <= 20
            if head and line.startswith("Status:") and not self.hasstatus[cur]:
                self.stat[cur] = norm_status(line[len("Status:"):])
                self.hasstatus[cur] = True
            if head and line.startswith("Blocked by:") and cur not in self.hasblk:
                self.hasblk.add(cur)
                self.blk[cur].extend(int(m) for m in _DIGITS_RE.findall(line[len("Blocked by:"):]))
            if head and line.startswith("Type:") and cur not in self.hastype:
                self.hastype.add(cur)
                self.typ[cur] = _first_word(line.lower(), "type:")
            if head and line.startswith("Test first:") and cur not in self.hastf:
                self.hastf.add(cur)
                self.tf[cur] = _first_word(line.lower(), "test first:")
            if head and line.startswith("Review:") and cur not in self.hasreview:
                self.hasreview.add(cur)
                self.review[cur] = _first_word(line.lower(), "review:")
            if head and line.startswith("Builder:") and cur not in self.hasbuilder:
                self.hasbuilder.add(cur)
                self.builder[cur] = _first_word(line.lower(), "builder:").strip("`")
            if head and line.startswith("Level:") and cur not in self.haslevel:
                self.haslevel.add(cur)
                self.level[cur] = _first_word(line.lower(), "level:")
            if head and line.startswith("Touches:") and cur not in self.hastouches:
                self.hastouches.add(cur)
                self.touches[cur] = [w for w in re.split(r"[,\s]+", line[len("Touches:"):].replace("`", ""))
                                     if w and w != "—"]
            if line.startswith("# ") and cur not in self.hastitle:
                self.hastitle.add(cur)
                self.title[cur] = line[2:]
            if line.startswith("## Done when"):
                self.hasdone[cur] = True
            if line.startswith("## "):
                skipm = re.match(r"^(not in this ticket|answer|review findings)", line[3:].lower()) is not None
                continue
            if not skipm and fnr > 1:
                for seg in _MENTION_RE.finditer(line):
                    for num in _DIGITS_RE.findall(seg.group(0)):
                        m = int(num)
                        if m < 1000 and m not in ment:
                            ment.append(m)


def _first_word(lowered, key):
    v = re.sub(r"^%s[ \t]*" % re.escape(key), "", lowered)
    return re.sub(r"[ \t].*$", "", v, flags=re.S)
