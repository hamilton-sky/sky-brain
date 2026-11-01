"""The conductor's own proof of a ticket: the check block in its Done when."""

import os
import re
import shutil
import tempfile
from pathlib import Path
from dataclasses import dataclass

from feature_flow import floorguard, gate, git, proc

FENCE = "```"
OPEN = FENCE + "check"


@dataclass(frozen=True)
class Check:
    """One `$ <command>`: exit is an int or "nonzero"; prints holds the substrings the output must contain;
    needs names what the check needs that a host may not have (network, a model), or is ""."""
    command: str
    exit: object = 0
    prints: tuple = ()
    needs: str = ""


class ParseError(ValueError):
    """A check block the parser cannot read. The message quotes the line."""


def _done_when(text):
    """The lines from the `## Done when` line up to the next line starting with `## `."""
    lines = [line[:-1] if line.endswith("\r") else line for line in text.split("\n")]
    out = None
    for line in lines:
        if out is None:
            if line.startswith("## Done when"):
                out = []
            continue
        if line.startswith("## "):
            break
        out.append(line)
    return out or []


def checks_in(text):
    """The checks of every ```check block in the ticket's Done when, in order."""
    checks = []
    fence = None  # None outside a fence, else the line that opened it
    current = None  # [command, exit, prints, exit_seen, needs] of the check being read

    def finish():
        if current is not None:
            checks.append(Check(current[0], current[1], tuple(current[2]), current[4]))

    for line in _done_when(text):
        if fence is None:
            if line.startswith(FENCE):
                fence = line
            continue
        if line == FENCE:
            if fence == OPEN:
                finish()
                current = None
            fence = None
            continue
        if fence != OPEN:
            continue
        if line.strip() == "" or line.startswith("#"):
            continue
        if line.startswith("$ ") and line[2:].strip():
            finish()
            current = [line[2:].strip(), 0, [], False, ""]
            continue
        word = line.split(" ", 1)[0]
        if word in ("exit", "prints", "needs") and current is None:
            raise ParseError("check block: %r comes before the first `$ <command>` line" % line)
        if word == "exit":
            value = line[len("exit "):].strip() if line.startswith("exit ") else ""
            if current[3]:
                raise ParseError("check block: %r is a second exit line for %r" % (line, current[0]))
            if value == "nonzero":
                current[1] = "nonzero"
            elif re.fullmatch(r"[0-9]+", value):
                current[1] = int(value)
            else:
                raise ParseError("check block: %r needs a whole number or `nonzero`" % line)
            current[3] = True
            continue
        if word == "prints" and line.startswith("prints ") and line[len("prints "):]:
            current[2].append(line[len("prints "):])
            continue
        if word == "needs" and line[len("needs "):].strip():
            current[4] = " ".join(line[len("needs "):].split())
            continue
        raise ParseError("check block: cannot read %r (expected `$ <command>`, `exit <N>`, "
                         "`exit nonzero`, `prints <text>`, `needs <what>`, `#` or a blank line)" % line)
    if fence == OPEN:
        raise ParseError("check block: %r is never closed by a %s line" % (fence, FENCE))
    return checks


def _wanted(check):
    want = "exit nonzero" if check.exit == "nonzero" else "exit %d" % check.exit
    return want + "".join(" and output containing %r" % text for text in check.prints)


def run_checks(checks, timeout, deferred=None, cwd=None):
    """Run every check (none is skipped after a failure) in the repo top of cwd (None: the working folder), or in
    cwd itself outside a repo. timeout is minutes, a float is fine, 0 for none.
    Returns (ok, report); the report names each failing command, what was wanted, what happened and the
    last lines of its output. A failing check with a `needs` line is not a failure: it is appended to
    deferred (a list) as (check, what happened), when deferred is given."""
    top = git.toplevel(cwd=cwd)
    return _run_checks(checks, timeout, [], deferred, str(top) if top is not None else cwd)


def _run_checks(checks, timeout, failures, deferred, where):
    for check in checks:
        with tempfile.TemporaryFile() as log:
            args, use_shell = gate.shell(check.command)
            code, timed_out = proc.run(args, use_shell, log, timeout, cwd=where)
            log.seek(0)
            output = log.read().decode("utf-8", "replace").replace("\r\n", "\n")
        if timed_out:
            got = "timed out after %s minutes" % format(timeout, "g")
        else:
            code_ok = code != 0 if check.exit == "nonzero" else code == check.exit
            if code_ok and all(text in output for text in check.prints):
                continue
            got = "exit %d" % code
        if check.needs and deferred is not None:
            deferred.append((check, got))
            continue
        failures.append("$ %s\n  wanted: %s\n  got: %s\n  the last lines of its output:\n%s"
                        % (check.command, _wanted(check), got, gate.tail(output)))
    return not failures, "\n".join(failures)


class GitError(RuntimeError):
    """A git call of the test-first check failed. The message names the git error and what to undo by hand."""


RECOVER = ("If the test and the code are in one commit (or the test commit sits on top of code that is already "
           "there), recover: revert that commit, commit the test files alone, then restore the production "
           "files in a later commit (git checkout <the old commit> -- <paths>). Do not rewrite history.")


def wants_test_first(text):
    """True when the ticket's header lines (before its first `## ` heading) say `Test first: yes`."""
    for line in text.split("\n"):
        if line.startswith("## "):
            break
        if re.match(r"^Test first:[ \t]*yes\b", line, re.IGNORECASE):
            return True
    return False


def review_mode(text):
    """`full` when the ticket's header lines (before its first `## ` heading) say `Review: full`, else `auto`."""
    for line in text.split("\n"):
        if line.startswith("## "):
            break
        if re.match(r"^Review:[ \t]*full\b", line, re.IGNORECASE):
            return "full"
    return "auto"


def declared_level(text):
    """1, 2 or 3 from the ticket's `Level:` header line (before its first `## ` heading), else 0 (none)."""
    for line in text.split("\n"):
        if line.startswith("## "):
            break
        match = re.match(r"^Level:[ \t]*([123])\b", line)
        if match:
            return int(match.group(1))
    return 0


def repo_relative(path, cwd=None):
    """path as a posix path relative to the repository root (git's own spelling), when it is inside it. A relative
    path is read under cwd (None: the working folder)."""
    top = git.toplevel(cwd=cwd)
    path = Path(path)
    if top is not None:
        try:
            path = (path if path.is_absolute() else Path(cwd or Path.cwd()) / path).resolve().relative_to(top.resolve())
        except (ValueError, OSError):
            pass
    return path.as_posix()


def _candidates(base, plan_dir, cwd=None):
    """The commits after base (oldest first, first parent only) that change test files and nothing else
    outside the plan folder, and whose whole tree differs from base only in test files and the plan folder
    (a test commit on top of production changes does not count). git runs in cwd (None: the working folder)."""
    prefix = repo_relative(plan_dir, cwd=cwd).rstrip("/") + "/"
    found = []
    for sha in git._git("rev-list", "--reverse", "--first-parent", "%s..HEAD" % base, cwd=cwd).stdout.split():
        paths = git._git("diff-tree", "--no-commit-id", "--name-only", "-r", sha, cwd=cwd).stdout.splitlines()
        paths = [p for p in paths if not p.startswith(prefix)]
        if not (paths and all(floorguard.DELETED_TEST.search(p) for p in paths)):
            continue
        total = git._git("diff", "--name-only", base, sha, cwd=cwd).stdout.splitlines()
        if all(p.startswith(prefix) or floorguard.DELETED_TEST.search(p) for p in total):
            found.append(sha)
    return found


def _status(cwd=None):
    """(code, path) of every change `git status` sees, untracked files listed one by one."""
    entries = git._git("status", "--porcelain", "-z", "--untracked-files=all", cwd=cwd).stdout.split("\0")
    out = []
    i = 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if len(entry) < 4:
            continue
        if entry[0] in "RC":
            i += 1
        out.append((entry[:2], entry[3:]))
    return out


def _ignored(cwd=None):
    """Paths git ignores right now (the `!!` entries), listed one by one."""
    out = git._git("status", "--porcelain", "-z", "--ignored", "--untracked-files=all", cwd=cwd).stdout.split("\0")
    return {entry[3:] for entry in out if entry.startswith("!! ")}


def _drop_ignored(had_ignored, cwd=None):
    """Remove the ignored files the Test command made, and the empty folders they leave. Old ones stay."""
    top = git.toplevel(cwd=cwd)
    root = Path(str(top)) if top is not None else Path(cwd or os.getcwd())
    for path in sorted(_ignored(cwd) - had_ignored, key=len, reverse=True):
        target = root / path
        try:
            if target.is_dir() and not target.is_symlink():
                shutil.rmtree(str(target))
            elif target.exists() or target.is_symlink():
                target.unlink()
        except OSError:
            continue
        parent = target.parent
        while parent != root and root in parent.parents:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent


def _undo(had, cwd=None):
    """Undo what the Test command did: the tree was clean (apart from the untracked files in had) before."""
    now = _status(cwd)
    if any(code != "??" for code, _ in now):
        git._git("reset", "-q", "--hard", cwd=cwd)
    made = [path for code, path in now if code == "??" and path not in had]
    if made:
        git._git("clean", "-fdq", "--", *made, cwd=cwd)


def _red(sha, test_command, timeout, remember, cwd=None):
    """Run the Test command with HEAD detached at sha, then go back. True when it failed (not a timeout). git runs in
    cwd (None: the working folder), the Test command and the undo in its repo top."""
    result = git._git("symbolic-ref", "-q", "--short", "HEAD", check=False, cwd=cwd)
    value = result.stdout.strip() if result.returncode == 0 and result.stdout.strip() else git.head(cwd=cwd)
    before = _status(cwd)
    if any(code != "??" for code, _ in before):
        raise GitError("the working copy has uncommitted changes to tracked files (%s), so the red run cannot "
                       "be undone safely. commit or stash them and run again"
                       % " ".join(path for code, path in before if code != "??")[:200])
    had = {path for _, path in before}
    had_ignored = _ignored(cwd)
    remember(value)
    try:
        try:
            git._git("checkout", "-q", "--detach", sha, cwd=cwd)
        except RuntimeError as err:
            raise GitError("%s. the working copy may be left detached: run `git checkout %s` by hand to go back"
                           % (err, value))
        top = git.toplevel(cwd=cwd)
        where = str(top) if top is not None else cwd
        with tempfile.TemporaryFile() as log:
            args, use_shell = gate.shell(test_command)
            code, timed_out = proc.run(args, use_shell, log, timeout, cwd=where)
        _undo(had, where)
        _drop_ignored(had_ignored, where)
    finally:
        try:
            git._git("checkout", "-q", value, cwd=cwd)
        except RuntimeError as err:
            raise GitError("%s. the working copy is left at %s: run `git checkout %s` by hand to go back"
                           % (err, sha[:10], value))
        remember("")
    return not timed_out and code != 0


def _repo_of(plan_dir):
    """The top of the repo an absolute plan_dir is in, as a str; None for a relative one (the working folder)."""
    path = Path(plan_dir)
    if not path.is_absolute() or not path.is_dir():
        return None
    top = git.toplevel(cwd=str(path))
    return str(top) if top is not None else None


def test_first(base, test_command, plan_dir, timeout, remember):
    """Prove a test-only commit between base and HEAD fails the Test command. Returns (ok, text): the note
    for the reviewer, or the send-back finding. remember(value) records the branch (or sha) to go back to
    while HEAD is detached, and "" once it is back. Raises GitError when git cannot switch. An absolute plan_dir
    names the repo too: the check runs in the repo it is in; a relative one is read in the working folder."""
    cwd = _repo_of(plan_dir)
    found = _candidates(base, plan_dir, cwd)
    if not found:
        return False, ("no commit between base and HEAD changes only test files. Commit the failing test "
                       "alone first, then the code. A test commit does not count when earlier commits already changed "
                       "production files. "
                       + RECOVER)
    for sha in found:
        if _red(sha, test_command, timeout, remember, cwd):
            return True, "the conductor saw %s fail the Test command before the code" % sha[:10]
    return False, ("the test-only commit(s) %s: the Test command passes without the production change (or timed "
                   "out after %s minutes), so it does not show a failing test before the code. Write a test that "
                   "fails without the production change. %s"
                   % (", ".join(sha[:10] for sha in found), format(timeout, "g"), RECOVER))
