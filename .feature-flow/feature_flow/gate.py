"""The gate.

usage: python3 scripts/gate.py <feature>
runs the Build, Test, Lint, Typecheck and Security commands from plans/<feature>/commands.md in that order,
then each `Check <path>:` command, and stops at the first one that fails. A `Check <path>:` line (`Check web/: npm
run e2e`) runs only for a build that changed a path it names (a folder ends with /, a * glob crosses folders);
run by hand, every one runs. empty values and placeholders in angle brackets are skipped.
the commands run from the current directory and must exit non zero on failure.
exit 0 everything passed or nothing to run, 1 a command failed, 2 usage error.

Each command's output goes to one log per feature, .feature-flow/state/gate-<feature>.log at the top of the git
worktree (a temporary file outside one), which can be read while it runs. The gate names the log, says how long each
command took, and while a command runs it prints a "still running" line every minute.

Text is str (UTF-8 with errors="surrogateescape", so any byte comes back out unchanged).
"""

import os
import re
import sys
import tempfile
import time
from pathlib import Path

from feature_flow import proc

KEYS = ("Build", "Test", "Lint", "Typecheck", "Security")
PATH_CHECK = re.compile(r"^Check[ \t]+([^:\s]+):[ \t]*(.*)$")
TAIL = 40
DEFAULT_TIMEOUT = 30
EVERY = 60  # seconds between the "still running" lines


def shell(cmd):
    """How to run a command from commands.md: bash -c on Linux and macOS, the system shell (cmd.exe)
    on Windows, where `bash` on PATH may be the Windows Subsystem for Linux stub and git-bash is not
    a requirement. Returns (args, use_shell) for subprocess."""
    if sys.platform == "win32":
        return cmd, True
    return ["bash", "-c", cmd], False


def command(path, key):
    """The value of the first `<key>:` line of commands.md, without backticks, or ""."""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="surrogateescape")
    except OSError:
        return ""
    for line in text.split("\n"):
        if line.startswith(key + ":"):
            return line[len(key) + 1:].lstrip(" \t").rstrip("\r").replace("`", "")
    return ""


def path_checks(path):
    """[(path pattern, command)] of the `Check <path>:` lines of commands.md, placeholders left out."""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="surrogateescape")
    except OSError:
        return []
    found = []
    for line in text.split("\n"):
        m = PATH_CHECK.match(line.rstrip("\r"))
        if m and m.group(2).replace("`", "").strip() and not m.group(2).replace("`", "").strip().startswith("<"):
            found.append((m.group(1).replace("`", ""), m.group(2).replace("`", "").strip()))
    return found


def tail(text, n=TAIL):
    """The last n lines of text (a last line without a newline counts)."""
    if not text:
        return ""
    if text.endswith("\n"):
        return "\n".join(text[:-1].split("\n")[-n:]) + "\n"
    return "\n".join(text.split("\n")[-n:])


def clock(seconds):
    """Seconds as `42s` or `4m12s`."""
    seconds = int(round(seconds))
    return "%dm%02ds" % (seconds // 60, seconds % 60) if seconds >= 60 else "%ds" % seconds


def log_path(feature, cwd=None):
    """The gate's log for feature, .feature-flow/state/gate-<feature>.log at the top of the git worktree that holds
    cwd (None: the working folder), the folder made with its ignore rule; None outside a git worktree or when the
    folder cannot be made."""
    from feature_flow import git, state  # here, so scripts/gate.py stays quick to load
    try:
        top = git.toplevel(cwd)
        return None if top is None else state.state_dir(top) / ("gate-%s.log" % feature)
    except OSError:
        return None


def _open_log(feature, cwd):
    path = log_path(feature, cwd)
    if path is not None:
        try:
            return path, open(str(path), "w+b")
        except OSError:
            pass
    return None, tempfile.TemporaryFile()


def timeout_minutes():
    """FLOW_GATE_TIMEOUT in minutes (default 30, 0 for none). Raises ValueError naming the variable."""
    value = os.environ.get("FLOW_GATE_TIMEOUT", "")
    try:
        return int(value) if value.strip() else DEFAULT_TIMEOUT
    except ValueError:
        raise ValueError("FLOW_GATE_TIMEOUT must be a whole number, not %s" % value)


def run(feature, out, err, timeout=None, quick=False, cwd=None, changed=None, progress=None, timings=None,
        every=EVERY, announce=False):
    """Run the gate for feature. out and err take text. timeout is minutes (a float is fine), 0 for none;
    None reads FLOW_GATE_TIMEOUT. With quick, a usable Quick: value runs in the place of Test. cwd is the folder
    commands.md is read under and the commands run in, None for the working folder. changed is the paths the build
    changed, which pick the `Check <path>:` commands to run; None runs them all. progress, when given, takes a
    "still running" line every `every` seconds while a command runs, and with announce also each command as it
    starts (for a caller whose out is read only at the end). timings, when given, is a list that gets a
    (name, seconds) pair for each command that ran, the failed one included. Returns the exit code."""
    if not feature:
        err("usage: python3 scripts/gate.py <feature>\n")
        return 2
    if timeout is None:
        try:
            timeout = timeout_minutes()
        except ValueError as problem:
            err("gate: %s\n" % problem)
            return 2
    path = Path(os.environ.get("FLOW_DIR") or "plans") / feature / "commands.md"
    if cwd is not None:
        path = Path(cwd) / path
    if not path.is_file():
        out("gate: no commands.md for " + feature + ", nothing to run\n")
        return 0
    from feature_flow import tickets  # here, so scripts/gate.py stays quick to load
    quick_cmd = command(path, "Quick") if quick else ""
    todo = []
    for key in KEYS:
        cmd = command(path, key)
        if key == "Test" and quick_cmd != "" and not quick_cmd.startswith("<"):
            key, cmd = "Quick", quick_cmd
        todo.append((key, cmd))
    for pattern, cmd in path_checks(path):
        if changed is None or any(tickets.matches_sensitive(p, [pattern]) for p in changed):
            todo.append(("Check " + pattern, cmd))
    todo = [(key, cmd) for key, cmd in todo if cmd != "" and not cmd.startswith("<")]
    if not todo:
        out("gate: no commands defined, nothing to run\n")
        return 0
    took = []
    started = time.monotonic()
    where, log = _open_log(feature, cwd)
    with log:
        if where is not None:
            out("gate: output in %s\n" % where)
        for key, cmd in todo:
            out("gate: " + key + ": " + cmd + "\n")
            if announce and progress is not None:
                progress("gate: %s: %s%s\n" % (key, cmd, "" if where is None else " (output in %s)" % where))
            log.seek(0, os.SEEK_END)  # after the last command's output, which its process wrote past our position
            log.write(("==== gate: %s: %s\n" % (key, cmd)).encode("utf-8", "surrogateescape"))
            log.flush()
            mark = log.tell()

            def tick(seconds, key=key):
                progress("gate: %s still running, %s%s\n" % (
                    key, clock(seconds), "" if where is None else ", output in %s" % where))
            began = time.monotonic()
            args, use_shell = shell(cmd)
            code, timed_out = proc.run(args, use_shell, log, timeout, cwd=cwd,
                                       tick=tick if progress is not None else None, every=every)
            seconds = time.monotonic() - began
            took.append((key, seconds))
            if timings is not None:
                timings.append((key, seconds))
            if timed_out:
                out("gate: %s timed out after %s minutes, stopped: %s\n" % (key, format(timeout, "g"), cmd))
                return 1
            if code != 0:
                log.seek(mark)
                out("gate: %s failed after %s. the last lines of its output:\n" % (key, clock(seconds)))
                out(tail(log.read().decode("utf-8", "surrogateescape")))
                return 1
    out("gate: %d command(s) passed in %s (%s)\n" % (
        len(took), clock(time.monotonic() - started), ", ".join("%s %s" % (k, clock(t)) for k, t in took)))
    return 0


def _writer(stream):
    def write(text):
        stream.buffer.write(text.encode("utf-8", "surrogateescape"))
        stream.buffer.flush()
    return write


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    sys.stdout.flush()
    sys.stderr.flush()
    return run(argv[0] if argv else "", _writer(sys.stdout), _writer(sys.stderr), progress=_writer(sys.stderr))
