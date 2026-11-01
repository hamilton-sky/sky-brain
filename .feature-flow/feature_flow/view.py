"""The graph page writer, ported from the bash flow-view script with the same output and exit codes.

usage: python3 scripts/flow-view.py <feature> [--watch] [--no-open] [--out FILE]
writes one self contained HTML page that shows the ticket graph, animated, and opens it.
the page can replay the run from git history.
--watch rewrites the page every few seconds until the feature is complete.
env: FLOW_DIR, FLOW_TICKETS (ticket location), FLOW_NO_OPEN=1 (never open a browser),
     FLOW_WATCH_SECONDS (default 3)

The page is scripts/flow-view.html (next to the script that was run) with the plan's data put in
place of __FLOW_DATA__. The template and the data are handled as bytes, so the page matches the
bash version byte for byte. Where the awks the bash version ran under disagree, this port reads
the ticket text as characters (gawk in a UTF-8 locale: a cut never splits a character) and treats
a line of spaces, tabs, carriage returns, vertical tabs and form feeds as blank (mawk).
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

from feature_flow import status, tickets

USAGE = "usage: python3 scripts/flow-view.py <feature> [--watch] [--no-open] [--out FILE]"
REFRESH = b'<meta http-equiv="refresh" content="3">'
BLANK = " \t\n\r\v\f"  # what splits fields in mawk; a line made only of these has NF == 0
_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_ASCII_LOWER = str.maketrans(_UPPER, _UPPER.lower())
_SLEEP = re.compile(r"^([0-9]+\.?[0-9]*|\.[0-9]+)([smhd]?)$")
_UNITS = {"": 1, "s": 1, "m": 60, "h": 3600, "d": 86400}


class Stop(Exception):
    """Ends the run with an exit code, the way set -e ends the bash script."""

    def __init__(self, code):
        Exception.__init__(self, code)
        self.code = code


class _Text:
    def __init__(self):
        self.text = ""

    def write(self, text):
        self.text += text


class _Null:
    def write(self, text):
        pass


def _lower(s):
    """awk's tolower as mawk does it: ASCII letters only."""
    return s.translate(_ASCII_LOWER)


def extras(path):
    """The awk ticket_extras program: Done when bullets, the Answer excerpt and the review rounds.

    Returns the object without its closing brace, as the bash version prints it."""
    sect = ""
    rounds, done_when, ans = [], [], ""
    for line in tickets.records(path):
        if line.startswith("## "):
            sect = _lower(line[3:])
            if sect.startswith("review findings"):
                n, src = 0, ""
                m = re.search(r"round [0-9]+", line)
                if m:
                    n = int(m.group(0)[6:])
                m = re.search(r", [^)]*\)", line)
                if m:
                    src = m.group(0)[2:-1]
                rounds.append('{"n":%d,"source":%s}' % (n, status.jstr(src)))
            continue
        if sect == "done when" and line.startswith("- ") and len(done_when) < 8:
            done_when.append(status.jstr(line[2:][:240]))
            continue
        if sect == "answer" and line.strip(BLANK) and not line.startswith("<") and len(ans) < 700:
            ans = line if ans == "" else ans + "\001" + line
    if "left empty until" in ans:
        ans = ""
    return '{"done_when":[%s],"answer":%s,"rounds":[%s]' % (",".join(done_when), status.jstr(ans[:700]),
                                                          ",".join(rounds))


def _git(args):
    """git's stdout as bytes, whatever its exit code; b"" when git cannot run. stderr is dropped."""
    try:
        return subprocess.run(["git"] + args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout
    except OSError:
        return b""


def show_status(blob):
    """The status word the bash history awk prints for a ticket as git stored it, or b""."""
    for line in blob.split(b"\n")[:20]:
        if line.startswith(b"Status:"):
            s = re.sub(rb"^Status:[ \t]*", b"", line.rstrip(b"\r")).lower()
            s = re.sub(rb"[ \t(].*$", b"", s, flags=re.S)
            if s in (b"resolved", b"done", b"closed"):
                return b"resolved"
            if s in (b"parked", b"wontfix"):
                return b"parked"
            return b"open"
    return b""


def history(path, gitdir):
    """Every commit that touched the ticket, oldest first, with the status it had then."""
    if not gitdir:
        return "[]"
    log = _git(["log", "--reverse", "--format=%H %at", "--", path])
    lines = log.split(b"\n")
    lines.pop()  # read stops at the last newline: an unterminated last line is never read
    out = []
    for line in lines:
        sha, _, at = line.strip(b" \t").partition(b" ")
        at = at.strip(b" \t")
        if not sha:
            continue
        st = show_status(_git(["show", (sha.decode("ascii", "surrogateescape") + ":./" + path)]))
        if not st:
            continue
        out.append('{"t":%s,"status":"%s"}' % (at.decode("utf-8", "surrogateescape"), st.decode("ascii")))
    return "[%s]" % ",".join(out)


def build_json(feature, folder, gitdir, err):
    """The page data, as text; raises Stop when the status reader fails (the bash set -e exit)."""
    core_out = _Text()
    rc = status.run([feature, "--json"], core_out, err)
    if rc != 0:
        raise Stop(rc)
    core = core_out.text.rstrip("\n")
    if core.endswith("}"):
        core = core[:-1]
    details = []
    for path in tickets.ticket_files(folder):
        name = path.rsplit("/", 1)[-1]
        if name.endswith(".md") and name != ".md":
            name = name[:-3]
        label = name.split("-", 1)[0]
        details.append('"%s":%s,"history":%s}' % (label, extras(path), history(path, gitdir)))
    generated = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return '%s,"generated":"%s","details":{%s}}' % (core, generated, ",".join(details))


def page(template, data, refresh):
    """The template with the refresh tag and the data put in, as the bash render awk writes it."""
    records = template.split(b"\n")
    if template.endswith(b"\n"):
        records.pop()
    elif not template:
        records = []
    data = data.replace(b"\n", b"")  # getline reads the data line by line and prints them joined
    out = []
    for rec in records:
        if b"<!--__REFRESH__-->" in rec:
            rec = rec.replace(b"<!--__REFRESH__-->", refresh, 1)
        p = rec.find(b"__FLOW_DATA__")
        if p >= 0:
            out.append(rec[:p] + data + rec[p + 13:] + b"\n")
        else:
            out.append(rec + b"\n")
    return b"".join(out)


class View:
    def __init__(self, feature, folder, template, out_path, gitdir, out, err):
        self.feature, self.folder, self.template = feature, folder, template
        self.out_path, self.gitdir, self.out, self.err = out_path, gitdir, out, err

    def render(self, watch):
        fd, tmp = tempfile.mkstemp()  # like mktemp: on a failure below it is left behind, as in bash
        os.close(fd)
        data = build_json(self.feature, self.folder, self.gitdir, self.err)
        data = data.encode("utf-8", "surrogateescape").replace(b"<", b"\\u003c")
        with open(tmp, "wb") as handle:
            handle.write(data)
        parent = os.path.dirname(self.out_path.rstrip("/")) or "."
        try:
            os.makedirs(parent, exist_ok=True)
            with open(tmp, "rb") as handle:
                data = handle.read()
            with open(self.template, "rb") as handle:
                template = handle.read()
            with open(self.out_path + ".tmp", "wb") as handle:
                handle.write(page(template, data, REFRESH if watch else b""))
            target = self.out_path
            if os.path.isdir(target):  # mv moves the file into a directory of that name
                target = os.path.join(target, os.path.basename(self.out_path + ".tmp"))
            os.replace(self.out_path + ".tmp", target)
        except OSError as e:
            self.err.write("flow-view: %s\n" % e)
            raise Stop(1)
        os.remove(tmp)

    def open_page(self, opening):
        if not opening or os.environ.get("FLOW_NO_OPEN", "") == "1":
            return
        sys.stdout.flush()
        if shutil.which("open"):
            rc = subprocess.call(["open", self.out_path])
            if rc != 0:
                raise Stop(rc)
        elif shutil.which("xdg-open"):
            subprocess.call(["xdg-open", self.out_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def pause(value, err):
    """sleep "$FLOW_WATCH_SECONDS": a number with an optional s, m, h or d suffix."""
    m = _SLEEP.match(value)
    if not m:
        err.write("sleep: invalid time interval '%s'\nTry 'sleep --help' for more information.\n" % value)
        raise Stop(1)
    time.sleep(float(m.group(1)) * _UNITS[m.group(2)])


def _pwd():
    """The working directory as bash sees it: $PWD when it names this directory, else the real path."""
    pwd = os.environ.get("PWD", "")
    try:
        if os.path.isabs(pwd) and os.path.samefile(pwd, "."):
            return pwd
    except OSError:
        pass
    return os.getcwd()


def script_dir(script):
    """What $(cd "$(dirname "$0")" && pwd) prints: the script's folder, logical, not resolved."""
    d = os.path.dirname(script) or "."
    return os.path.normpath(os.path.join(_pwd(), d))


def run(argv, out, err, here):
    """Write what the bash script would to out and err, and return its exit code."""
    try:
        return _run(list(argv), out, err, here)
    except Stop as stop:
        return stop.code


def _run(argv, out, err, here):
    def usage():
        err.write(USAGE + "\n")
        raise Stop(2)

    if not argv or argv[0] == "":
        usage()
    feature = argv[0]
    rest = argv[1:]
    watch, opening, out_path = False, True, ""
    while rest:
        arg = rest.pop(0)
        if arg == "--watch":
            watch = True
        elif arg == "--no-open":
            opening = False
        elif arg == "--out":
            out_path = rest.pop(0) if rest else ""
            if out_path == "":
                usage()
        else:
            usage()

    folder = "%s/%s/%s" % (os.environ.get("FLOW_DIR") or "plans", feature, os.environ.get("FLOW_TICKETS") or "tasks")
    if not os.path.isdir(folder):
        err.write("no ticket folder: %s\n" % folder)
        return 2
    template = here + "/flow-view.html"
    if not os.path.isfile(template):
        err.write("missing %s\n" % template)
        return 2

    gitdir = os.fsdecode(_git(["rev-parse", "--absolute-git-dir"]).rstrip(b"\n"))
    if out_path == "":
        base = gitdir if gitdir else (os.environ.get("TMPDIR") or "/tmp")
        out_path = "%s/flow-%s.html" % (base, feature)

    view = View(feature, folder, template, out_path, gitdir, out, err)
    view.render(watch)
    out.write("wrote %s\n" % out_path)
    view.open_page(opening)

    if watch:
        out.write("watching, press Ctrl-C to stop\n")
        while True:
            rc = status.run([feature, "--next"], _Null(), _Null())
            if rc == 10:
                view.render(False)
                out.write("feature complete, final page written\n")
                break
            view.render(True)
            pause(os.environ.get("FLOW_WATCH_SECONDS") or "3", err)
    return 0


def main(argv=None, here=None):
    argv = sys.argv[1:] if argv is None else argv
    here = script_dir(sys.argv[0]) if here is None else here
    sys.stdout.flush()
    try:
        return run(argv, status._Bytes(sys.stdout.buffer), status._Bytes(sys.stderr.buffer), here)
    except KeyboardInterrupt:  # Ctrl-C in --watch: bash dies of the signal and prints nothing
        return 130
