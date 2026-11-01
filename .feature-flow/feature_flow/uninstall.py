"""feature-flow uninstall: take out what `feature-flow install` put in a repo (or, with --user, in the home folder).

It reads the record the installer left: `.feature-flow/installed.txt` and `.feature-flow/installed.sha256` in
the repo, `feature-flow.sha256` in ~/.claude and ~/.agents. A file is removed only while it still holds the
bytes the installer wrote (or a released version's); one somebody edited is kept and named, unless --force.
Plans, tickets and the run state in `.feature-flow/state/` are never touched.
"""

import os
import shutil
import stat
import subprocess

from feature_flow.install import (EXCLUDE_BEGIN, EXCLUDE_END, HASHES, INSTALLED, USER_HASHES, Installer, _logical_cwd, flow_home,
                                  _read, _read_text, _sha256)
from feature_flow.released import RELEASED

USAGE = """\
usage: feature-flow uninstall [target-repo] [--user] [--force] [--dry-run]
removes the files `feature-flow install` wrote into the repo (.claude/, .agents/, scripts/, .feature-flow/),
and the lines a --private install put in .git/info/exclude.
  --user     remove the personal install in ~/.feature-flow, ~/.claude and ~/.agents instead (what `install --user` wrote)
  --force    also remove a file you edited since the install
  --dry-run  say what would be removed, change nothing
a file you edited is kept and named. plans/ and your tickets are never touched, nor is .feature-flow/state/.
CLAUDE_HOME overrides ~/.claude, AGENTS_HOME ~/.agents and FEATURE_FLOW_HOME ~/.feature-flow for --user.
"""


class Usage(Exception):
    pass


def parse(argv):
    opts = {"target": "", "user": False, "force": False, "dry": False}
    for a in argv:
        if a == "--user":
            opts["user"] = True
        elif a == "--force":
            opts["force"] = True
        elif a == "--dry-run":
            opts["dry"] = True
        elif a in ("-h", "--help"):
            return None
        elif a.startswith("-"):
            raise Usage("unknown option: " + a)
        else:
            opts["target"] = a
    return opts


def _recorded(path):
    return Installer._read_hashes(path)


def _inside(root, rel):
    """rel is a plain relative path that stays under root, through no symlinked folder."""
    if not rel or os.path.isabs(rel) or ".." in rel.replace("\\", "/").split("/"):
        return False
    parent = os.path.dirname(os.path.join(root, rel))
    parent, root = os.path.realpath(parent), os.path.realpath(root)
    try:
        return os.path.commonpath([parent, root]) == root  # also right for a repo at the filesystem root
    except ValueError:  # another drive on Windows
        return False


def _prune(root, rel, dry, owned=False):
    """Remove the folders above rel that the removal left empty, up to but not including root.
    owned: every folder under root belongs to the install, so bytecode in it is dropped too."""
    parent = os.path.dirname(rel)
    while parent and not dry:
        folder = os.path.join(root, parent)
        if owned or parent.replace("\\", "/").startswith(".feature-flow/"):  # a folder the install owns: drop bytecode python left
            shutil.rmtree(os.path.join(folder, "__pycache__"), ignore_errors=True)
        try:
            os.rmdir(folder)
        except OSError:
            break
        parent = os.path.dirname(parent)


def _exclude_file(target):
    try:
        r = subprocess.run(["git", "-C", target, "rev-parse", "--git-path", "info/exclude"],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True)
    except OSError:
        return None
    path = r.stdout.strip()
    if r.returncode != 0 or not path:
        return None
    return os.path.normpath(os.path.join(target, path))


def _drop_exclude_block(target, out, dry):
    path = _exclude_file(target)
    if path is None:
        return
    lines = _read_text(path).splitlines()
    if EXCLUDE_BEGIN not in lines or EXCLUDE_END not in lines[lines.index(EXCLUDE_BEGIN):]:
        return
    start = lines.index(EXCLUDE_BEGIN)
    end = lines.index(EXCLUDE_END, start)
    out("  unlist  the install block in %s" % path)
    if not dry:
        del lines[start:end + 1]
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write("".join(l + "\n" for l in lines))


def remove_install(root, names, record_path, extra, force, dry, out, owned=False):
    """Remove the files names (relative to root) that still hold their recorded bytes. Returns (removed, kept)."""
    recorded = _recorded(record_path)
    removed = kept = 0
    for rel in names:
        if rel in extra:
            continue
        path = os.path.normpath(os.path.join(root, rel))
        if not _inside(root, rel):
            out("  skipped %s (not a path inside %s)" % (rel, root))
            kept += 1
            continue
        if not os.path.lexists(path):
            continue
        mode = os.lstat(path).st_mode
        if stat.S_ISDIR(mode):
            out("  kept    %s (now a folder, left alone)" % path)
            kept += 1
            continue
        # only a regular file is read and hashed; a link or a special file (a FIFO would block) counts as changed,
        # and --force unlinks it without opening it or following it
        data = _read(path) if stat.S_ISREG(mode) else None
        # the path's own record decides; the released hashes cover only an install old enough to have none
        unchanged = data is not None and (_sha256(data) == recorded[rel] if rel in recorded else _sha256(data) in RELEASED)
        if not (unchanged or force):
            out("  kept    %s (edited since the install, use --force to remove it)" % path)
            kept += 1
            continue
        out("  remove  " + path)
        removed += 1
        if not dry:
            os.remove(path)
            _prune(root, rel, dry, owned)
    return removed, kept


def uninstall_repo(target, force, dry, out):
    listed = _read_text(target + "/" + INSTALLED)
    if not listed:
        out("no feature-flow install found in %s (no %s)" % (target, INSTALLED))
        return 1
    names = [n.strip() for n in listed.splitlines() if n.strip()]
    removed, kept = remove_install(target, names, target + "/" + HASHES, (INSTALLED, HASHES), force, dry, out)
    if not kept:
        for rel in (INSTALLED, HASHES):
            if os.path.lexists(target + "/" + rel):
                out("  remove  %s/%s" % (target, rel))
                removed += 1
                if not dry:
                    os.remove(target + "/" + rel)
                    _prune(target, rel, dry)
    _drop_exclude_block(target, out, dry)
    return _report(removed, kept, dry, out, target + "/.feature-flow/state")


def uninstall_user(force, dry, out):
    home = os.environ.get("HOME", "")
    removed = kept = found = 0
    flow = flow_home()
    for root in (flow, os.environ.get("CLAUDE_HOME") or home + "/.claude", os.environ.get("AGENTS_HOME") or home + "/.agents"):
        record = root + "/" + USER_HASHES
        recorded = _recorded(record)
        if not recorded:
            continue
        found += 1
        r, k = remove_install(root, sorted(recorded), record, (), force, dry, out, root == flow)
        removed += r
        kept += k
        if not k and os.path.lexists(record):
            out("  remove  " + record)
            removed += 1
            if not dry:
                os.remove(record)
        if root == flow and not k and not dry:
            shutil.rmtree(os.path.join(root, "__pycache__"), ignore_errors=True)
            try:
                os.rmdir(root)
            except OSError:
                pass
    if not found:
        out("no personal feature-flow install found in %s, %s/.claude or %s/.agents" % (flow, home, home))
        return 1
    return _report(removed, kept, dry, out, None)


def _report(removed, kept, dry, out, state):
    out("")
    out("%s %d, kept %d" % ("would remove" if dry else "removed", removed, kept))
    if state and os.path.isdir(state):
        out("note: %s holds run logs and was left alone; delete it yourself if you want it gone" % state)
    return 0


def run(argv, out, err):
    try:
        opts = parse(argv)
    except Usage as e:
        err(str(e))
        err(USAGE[:-1])
        return 2
    if opts is None:
        out(USAGE[:-1])
        return 0
    if opts["dry"]:
        out("dry run: nothing will be removed")
    if opts["user"]:
        return uninstall_user(opts["force"], opts["dry"], out)
    target = opts["target"] or "."
    if not os.path.isdir(target):
        err("no such directory: " + target)
        return 2
    target = os.path.normpath(os.path.join(_logical_cwd(), target))
    return uninstall_repo(target, opts["force"], opts["dry"], out)


def main(argv):
    import sys

    def writer(stream):
        def write(line):
            stream.buffer.write(os.fsencode(line) + b"\n")
            stream.buffer.flush()
        return write

    return run(argv, writer(sys.stdout), writer(sys.stderr))
