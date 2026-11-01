"""The few git calls the conductor needs, each one an argument list, never a shell string."""

import hashlib
import subprocess
from pathlib import Path


def _git(*args, check=True, cwd=None):
    result = subprocess.run(["git"] + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            universal_newlines=True, cwd=cwd)
    if check and result.returncode != 0:
        raise RuntimeError("git %s failed: %s" % (" ".join(args), result.stderr.strip()))
    return result


def show_text(revision_path, cwd=None):
    """`git show <rev>:<path>` decoded as UTF-8 (the platform's default encoding is not what a ticket is written in)."""
    result = subprocess.run(["git", "show", revision_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=cwd)
    if result.returncode != 0:
        raise RuntimeError("git show %s failed: %s" % (revision_path, result.stderr.decode("utf-8", "replace").strip()))
    return result.stdout.decode("utf-8", "replace").replace("\r\n", "\n")


def git_dir(cwd=None):
    result = _git("rev-parse", "--absolute-git-dir", check=False, cwd=cwd)
    if result.returncode != 0:
        return None
    return Path(result.stdout.strip())


def toplevel(cwd=None):
    result = _git("rev-parse", "--show-toplevel", check=False, cwd=cwd)
    if result.returncode != 0 or not result.stdout.strip():
        return None
    return Path(result.stdout.strip())


def head(cwd=None):
    return _git("rev-parse", "HEAD", cwd=cwd).stdout.strip()


def diff_size(base, head, exclude, cwd=None):
    """(files, lines, binary) of the diff base..head outside the exclude path: the changed paths, the
    added plus removed lines of the text files, and whether any file is binary (`-` counts in numstat).
    Renames are off so a renamed file is one delete plus one add whatever `diff.renames` says."""
    out = _git("diff", "--numstat", "--no-renames", base, head, "--", ".", ":(exclude)%s" % exclude,
               cwd=cwd).stdout
    files, lines, binary = 0, 0, False
    for line in out.splitlines():
        if not line.strip():
            continue
        added, removed = line.split("\t", 2)[:2]
        files += 1
        if added == "-" or removed == "-":
            binary = True
        else:
            lines += int(added) + int(removed)
    return files, lines, binary


def diff_names(base, head, exclude, cwd=None):
    """The paths changed in base..head outside the exclude path, renames off as in diff_size."""
    out = _git("diff", "--name-only", "--no-renames", base, head, "--", ".", ":(exclude)%s" % exclude,
               cwd=cwd).stdout
    return [line for line in out.splitlines() if line.strip()]


# the installer's record of what it wrote: the paths, and the sha256 of each as it wrote it
INSTALLED = Path(".feature-flow") / "installed.txt"
HASHES = Path(".feature-flow") / "installed.sha256"


def _read_lines(path):
    try:
        return path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return []


def changes(cwd=None):
    """Every changed path, untracked files included, as `git status --porcelain` sees them, except
    feature-flow's own install: a file still exactly as the installer wrote it, an untracked file it
    lists without a hash (an install from before it kept hashes), and its two record files, which every
    install rewrites; and untracked Python bytecode, which the flow's own Python runs leave behind."""
    listed, hashes = set(), {}
    top = toplevel(cwd=cwd)
    if top is not None:
        listed = set(_read_lines(top / INSTALLED))
        for line in _read_lines(top / HASHES):
            digest, _, name = line.partition("  ")
            hashes[name] = digest
    entries = _git("status", "--porcelain", "-z", "-uall", cwd=cwd).stdout.split("\0")
    found = []
    i = 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if len(entry) < 4:
            continue
        code, path = entry[:2], entry[3:]
        if code[0] in "RC":
            i += 1  # the rename's source path follows
        if path in (INSTALLED.as_posix(), HASHES.as_posix()):
            continue
        if path in hashes:
            # only a worktree change: a staged version would ride along in the next commit
            if (code[0] in " ?" and code[1] != "T" and top is not None and not (top / path).is_symlink()
                    and _sha256(top / path) == hashes[path]):
                continue
        elif code == "??" and (path in listed or _bytecode(path)):
            continue
        found.append(path)
    return found


def _sha256(path):
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def _bytecode(path):
    return path.endswith(".pyc") or "__pycache__/" in "/" + path


def is_clean(cwd=None):
    return not changes(cwd=cwd)


def tracked_clean(cwd=None):
    """No change to a tracked file, in the worktree or the index."""
    return (_git("diff", "--quiet", check=False, cwd=cwd).returncode == 0
            and _git("diff", "--cached", "--quiet", check=False, cwd=cwd).returncode == 0)


def undo_tracked(patch, cwd=None):
    """Save every change to a tracked file (worktree and index) as a patch, then put them back to HEAD.
    Untracked files stay. Returns the changed paths. A relative patch path is under cwd when given."""
    names = _git("diff", "--name-only", "HEAD", cwd=cwd).stdout.split("\n")
    diff = subprocess.run(["git", "diff", "--binary", "HEAD"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=cwd)
    (Path(cwd) / patch if cwd is not None else Path(patch)).write_bytes(diff.stdout)
    _git("reset", "-q", "--hard", "HEAD", cwd=cwd)
    return [name for name in names if name]


def commit_paths(paths, message, cwd=None):
    """Commit these paths only, whatever else is staged."""
    paths = [str(p) for p in paths]
    if _git("add", "--", *paths, check=False, cwd=cwd).returncode != 0:
        return False
    return _git("commit", "-q", "-m", message, "--", *paths, check=False, cwd=cwd).returncode == 0


def commit_file(path, message, cwd=None):
    if _git("add", "--", str(path), check=False, cwd=cwd).returncode != 0:
        return False
    return _git("commit", "-q", "-m", message, check=False, cwd=cwd).returncode == 0
