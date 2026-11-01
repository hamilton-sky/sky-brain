"""Parallel lanes: tickets whose `Touches:` paths do not overlap, built side by side in git worktrees.

A lane is a worktree in .feature-flow/lanes/<feature>/lane-<k> (git ignores the folder), kept for the
whole feature. Each ticket gets its own branch ff/<feature>/<NN> in a lane. A ticket that passes its
review is merged by the conductor in a third worktree, .feature-flow/lanes/<feature>/integrate, gated
there, and only then fast-forwarded onto the feature branch. The branch is deleted after the merge.
"""

import re
import shutil
import subprocess
from pathlib import Path

from feature_flow.conductor.store import RUN_KEYS, Scoped  # re-exported under their old names

LANES_DIR = Path(".feature-flow") / "lanes"
INTEGRATE = "integrate"
# plan files a builder (or the conductor) only appends to: two lanes appending is resolved by keeping both
APPEND_ONLY = ("map.md", "learnings.md", "followups.md", "decisions.md")
WILD = re.compile(r"[*?\[]")
MAX_LANES_PLAN = 4  # the most lanes a plan's width asks for (the conductor's MAX_LANES)


def branch(feature, num):
    return "ff/%s/%s" % (feature, num)


def folder(top, feature):
    return Path(top) / LANES_DIR / feature


def lane_path(top, feature, lane):
    return folder(top, feature) / ("lane-%d" % lane)


def integrate_path(top, feature):
    return folder(top, feature) / INTEGRATE


# ---- footprints ------------------------------------------------------------

def touches(text):
    """The path patterns on the ticket's `Touches:` header line (before its first `## `), split on commas
    and spaces, backticks dropped. None when the ticket has no such line."""
    for line in text.split("\n"):
        if line.startswith("## "):
            break
        if line.startswith("Touches:"):
            value = line[len("Touches:"):].replace("`", "")
            return [p[2:] if p.startswith("./") else p for p in re.split(r"[,\s]+", value) if p and p != "—"]
    return None


def literal(pattern):
    """The part of a pattern before its first wildcard: every path it can match starts with it."""
    match = WILD.search(pattern)
    return pattern[:match.start()] if match else pattern


def overlap(first, second):
    """True when two patterns may match a common path. Judged from their literal parts, so it can say yes
    for two patterns that never meet (a safe mistake: the tickets run one after the other), never no for
    two that do."""
    a, b = literal(first), literal(second)
    return a.startswith(b) or b.startswith(a)


def disjoint(first, second):
    return not any(overlap(p, q) for p in first for q in second)


def top_folder(pattern):
    """The first path segment of the pattern's literal part ("" when the pattern starts with a wildcard)."""
    lit = literal(pattern)
    return lit.split("/", 1)[0] if "/" in lit else (lit if lit == pattern else "")


def same_folder(first, second):
    """True when the two footprints share a top-level folder (or file), or either one could be anywhere."""
    mine = {top_folder(p) for p in first}
    theirs = {top_folder(p) for p in second}
    return "" in mine or "" in theirs or bool(mine & theirs)


def side_by_side(ticket, running, shared):
    """True when ticket may be built while the running tickets are. Each is (touches or None, level).
    A ticket without a Touches line, or one that touches a Shared path, runs alone. Two footprints must not
    overlap, and a level 3 ticket also keeps clear of the other's top-level folders."""
    if not running:
        return True
    mine, level = ticket
    if not mine or touches_shared(mine, shared):
        return False
    for theirs, their_level in running:
        if not theirs or touches_shared(theirs, shared) or not disjoint(mine, theirs):
            return False
        if 3 in (level, their_level) and same_folder(mine, theirs):
            return False
    return True


def touches_shared(patterns, shared):
    return any(overlap(p, s) for p in patterns for s in shared)


def why_apart(ticket, other, shared):
    """Why ticket cannot run beside other (each (touches or None, level)), in a few words; "" when it can."""
    mine, level = ticket
    theirs, their_level = other
    if not mine:
        return "it has no Touches: line"
    if touches_shared(mine, shared):
        return "it touches a Shared: path"
    if not theirs:
        return "the other has no Touches: line"
    if touches_shared(theirs, shared):
        return "the other touches a Shared: path"
    for p in mine:
        for q in theirs:
            if overlap(p, q):
                return "both touch %s" % (p if len(literal(p)) >= len(literal(q)) else q)
    if 3 in (level, their_level) and same_folder(mine, theirs):
        folders = sorted({top_folder(p) for p in mine} & {top_folder(p) for p in theirs} - {""})
        return "level 3 shares %s" % ("the folder %s/" % folders[0] if folders else "a folder")
    return ""


def plan_width(items, shared=(), cap=MAX_LANES_PLAN):
    """How many of the plan's open tickets can build at once, worked out the way the lanes lease them.

    items: [(number, touches or None, level or 0, [blocking numbers], done)]. Tickets are taken in waves: each
    wave is the tickets whose blockers are done, leased in number order beside the ones already in the wave when
    side_by_side allows. Returns (the widest wave, at most cap; [(number, the number it waited for, why)])."""
    info = {n: (t, lvl) for n, t, lvl, _, _ in items}
    blocked = {n: [b for b in bl if b in info] for n, _, _, bl, _ in items}
    done = {n for n, _, _, _, d in items if d}
    left = sorted(n for n in info if n not in done)
    widest, waits = 0, []
    while left:
        ready = [n for n in left if all(b in done for b in blocked[n])]
        if not ready:
            break  # a cycle or a missing blocker: the ticket check reports it
        wave = []
        for n in ready:
            if len(wave) < cap and side_by_side(info[n], [info[m] for m in wave], shared):
                wave.append(n)
            elif len(wave) < cap:
                other = next(m for m in wave if not side_by_side(info[n], [info[m]], shared))
                waits.append((n, other, why_apart(info[n], info[other], shared)))
        widest = max(widest, len(wave))
        done.update(wave)
        left = [n for n in left if n not in wave]
    return widest, waits


# ---- git in another folder -------------------------------------------------

def git_in(cwd, *args, check=True):
    result = subprocess.run(["git"] + list(args), cwd=str(cwd), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            universal_newlines=True)
    if check and result.returncode != 0:
        raise RuntimeError("git %s failed in %s: %s" % (" ".join(args), cwd, result.stderr.strip()))
    return result


def ensure(top, path):
    """Create the worktree at path, detached at the main worktree's HEAD, unless it is there.
    Returns True when it was created now."""
    if (path / ".git").exists():
        return False
    base = Path(top) / LANES_DIR
    base.mkdir(parents=True, exist_ok=True)
    ignore = base / ".gitignore"
    if not ignore.is_file():
        ignore.write_text("*\n", encoding="utf-8")
    if path.exists():
        raise RuntimeError("%s is in the way of a lane: it exists but is not a worktree" % path)
    git_in(top, "worktree", "add", "-q", "--detach", str(path), "HEAD")
    return True


def is_worktree(top, path):
    """True when git lists path as one of the repository's worktrees."""
    out = git_in(top, "worktree", "list", "--porcelain", check=False).stdout
    want = Path(path).resolve()
    for line in out.splitlines():
        if line.startswith("worktree ") and Path(line[len("worktree "):]).resolve() == want:
            return True
    return False


def remove_all(top, feature):
    """Remove the feature's lane and integration worktrees and prune git's records of them. Returns their names."""
    gone = []
    root = folder(top, feature)
    if root.is_dir():
        for path in sorted(root.iterdir()):
            if path.is_dir():
                git_in(top, "worktree", "remove", "--force", str(path), check=False)
                if path.exists():
                    shutil.rmtree(str(path), ignore_errors=True)
                gone.append(path.name)
        shutil.rmtree(str(root), ignore_errors=True)
    git_in(top, "worktree", "prune", check=False)
    return gone


def branches(top, feature):
    """The feature's ticket branches, ff/<feature>/*."""
    out = git_in(top, "for-each-ref", "--format=%(refname:short)", "refs/heads/ff/%s/" % feature, check=False).stdout
    return [line.strip() for line in out.splitlines() if line.strip()]


# ---- the merge -------------------------------------------------------------

def unmerged(cwd):
    return [p for p in git_in(cwd, "diff", "--name-only", "--diff-filter=U").stdout.splitlines() if p.strip()]


def stage(cwd, number, path):
    result = subprocess.run(["git", "show", ":%d:%s" % (number, path)], cwd=str(cwd),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return result.stdout if result.returncode == 0 else b""


def resolve_appends(cwd, plan):
    """Resolve a conflicted merge in cwd when every conflict is in the plan's append-only files and both
    sides only appended: keep the feature branch's lines, then the ticket's new lines. Returns the paths it
    could not resolve this way (empty when all are resolved and staged)."""
    allowed = {"%s/%s" % (plan, name) for name in APPEND_ONLY}
    paths = unmerged(cwd)
    left = [p for p in paths if p not in allowed]
    if left:
        return left
    for path in paths:
        base, ours, theirs = stage(cwd, 1, path), stage(cwd, 2, path), stage(cwd, 3, path)
        if not ours.startswith(base) or not theirs.startswith(base):
            return [path]
        if ours and not ours.endswith(b"\n"):
            ours += b"\n"
        (Path(cwd) / path).write_bytes(ours + theirs[len(base):])
        git_in(cwd, "add", "--", path)
    return []
