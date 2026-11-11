#!/usr/bin/env python3
"""The trusted check in front of every conductor call.

usage: FLOW_TRUST=<last TRUST digest | new> FLOW_SESSION=<token> python3 -I scripts/flow-trust.py [--after-build <ticket> <sha>] <feature> <command> [args...]

It hashes the flow's own files (the conductor, its package, guides, roles, skills and the run
state), refuses to call the conductor when they differ from the digest the session passed in
FLOW_TRUST, runs the conductor, and prints `TRUST <digest>` for the session to pass next time.
It stops when the flow's code changed during the call, or when the run state is not what the
conductor reported saving. After a BUILD, `--after-build <ticket> <sha>` accepts a code change
(never a state change) when the ticket at <sha> has `Floor: allow flow-edit`.

It imports nothing from the repo, on purpose: it is the code that decides whether the flow's
files on disk were changed, so it must not run any of them. The skill's loader checks this
file's sha256 against the hash pinned in the skill and runs those same bytes with `exec`, so
nothing a subagent can write decides the check. Standard library only, Python 3.9+.
"""
import sys

if not (sys.flags.isolated or getattr(sys.flags, "safe_path", 0)):
    first = sys.path.pop(0)  # our own folder, out of the way: nothing there may shadow a module
    import os

    own = os.path.dirname(os.path.realpath(globals().get("__file__") or sys.argv[1]))
    if os.path.normcase(os.path.realpath(first or os.curdir)) != os.path.normcase(own):
        sys.path.insert(0, first)  # not our own folder (started some other way): put it back
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

USAGE = ("STOP usage: FLOW_TRUST=<last TRUST digest | new> FLOW_SESSION=<token> python3 -I scripts/flow-trust.py "
         "[--after-build <ticket> <sha>] <feature> <command> [args...]")
NO_TRUST = "STOP pass FLOW_TRUST: the last TRUST digest, or new on this session's first call"
CHANGED = "STOP flow files changed since the last step: %s"
NEW_FEATURE = ("STOP no earlier conductor call for %s in this repo, so FLOW_TRUST cannot be its digest: a TRUST digest "
               "belongs to one feature. on a feature's first call pass FLOW_TRUST=new")
KILLED = "STOP the conductor was killed by signal %d"
DURING = "STOP flow code changed during %s: %s"
STATE_CHANGED = "STOP the run state was changed by something other than the conductor during %s"
NO_REPORT = "STOP the conductor did not report its state (it crashed?) during %s"
SCRIPTS = ("flow.py", "flow-status.py", "gate.py", "floor-guard.py", "flow-view.py", "flow-trust.py")
GUIDES = ("build.md", "review.md", "review-quality.md", "review-single.md", "review-feature.md", "plan.md", "plan-review.md", "replan.md", "test.md", "debug.md")  # prompts.GUIDES + debug.md
SKILL_GUIDES = ("brainstorm.md", "brief.md", "fix.md", "show.md")  # read by the skills themselves
LENSES = ("positive.md", "researcher.md", "open-minded.md", "artistic.md", "ux.md", "security.md")  # guides/lenses/
BUILDERS = ("frontend.md", "backend.md", "docs.md")  # guides/builders/, builders.NAMES
TEMPLATES = ("brainstorm.md", "commands.md", "learnings.md", "map.md", "spec.md", "ticket.md", "ui-mockup.md")  # guides/templates/
ROLES = ("ticket-builder.md", "ticket-reviewer.md", "feature-planner.md", "plan-reviewer.md", "flow-scout.md",
         "flow-web.md", "flow-architect.md", "flow-designer.md", "flow-po.md", "flow-skeptic.md", "flow-tester.md",
         "flow-lens.md")  # prompts.ROLES
OWNED = (".feature-flow/feature_flow", ".feature-flow/guides", ".feature-flow/agents",
         ".claude/skills/feature-flow", ".agents/skills/feature-flow", ".agents/flow-roles")
STATE_DIR = Path(".feature-flow") / "state"
STATE_KINDS = ("state", "findings")


def started():
    """(the folder this file is in, its own arguments), for both ways it can be started:
    directly (`__file__` set) or as `exec` of its bytes by the skill's loader, where
    sys.argv is ['-c', <this file>, <pinned sha>, args...]."""
    if "__file__" in globals():
        return Path(__file__).resolve().parent, sys.argv[1:]
    return Path(sys.argv[1]).resolve().parent, sys.argv[3:]


def parse(args):
    """(feature, command, the conductor's other args, (ticket, sha) or None), or None on a usage error."""
    after = None
    if "--after-build" in args:  # before the feature, as the usage says, or anywhere after it
        at = args.index("--after-build")
        if len(args) < at + 3:
            return None
        after = (args[at + 1], args[at + 2])
        args = args[:at] + args[at + 3:]
    if len(args) < 2:
        return None
    feature = args[0]
    if not feature or feature.startswith("-") or feature in (".", "..") or any(c in feature for c in "/\\:"):
        return None
    return feature, args[1], args[2:], after


def toplevel():
    try:
        out = subprocess.run(["git", "rev-parse", "--show-toplevel"], stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, universal_newlines=True)
    except OSError:
        out = None
    if out is not None and out.returncode == 0 and out.stdout.strip():
        return Path(out.stdout.strip()).resolve()
    return Path(os.getcwd()).resolve()


def home(variable, name):
    """$variable, else $HOME/name with an unset HOME read as empty, as the installer does."""
    return Path(os.environ.get(variable) or os.environ.get("HOME", "") + "/" + name).resolve()


def tree(folder, chain=frozenset()):
    """Every file under folder, skipping __pycache__/ and *.pyc. Linked folders are followed,
    since Python imports through them, and listed themselves so adding one changes the hash;
    one that loops back to a folder on its own path is listed but not entered again."""
    real = os.path.realpath(str(folder))
    if real in chain:
        return []
    try:
        names = sorted(os.listdir(str(folder)))
    except OSError:
        return []
    found = []
    for entry in names:
        path = folder / entry
        if path.is_symlink() and path.is_dir():
            found.append(path)
        if path.is_dir():
            if entry != "__pycache__":
                found += tree(path, chain | {real})
        elif not entry.endswith(".pyc"):
            found.append(path)
    return found


def code_files(here, top):
    """The flow's code files, as spec.md § Design "What is hashed" lists them (missing ones are skipped later)."""
    parent = here.parent
    found = [here / name for name in SCRIPTS] + tree(parent / "feature_flow")
    found += [parent / "guides" / name for name in GUIDES + SKILL_GUIDES] + [parent / "agents" / name for name in ROLES]
    found += [parent / "guides" / "templates" / name for name in TEMPLATES]
    found += [parent / "guides" / "lenses" / name for name in LENSES]
    found += [parent / "guides" / "builders" / name for name in BUILDERS]
    found += tree(parent / "packages" / "forkboard" / "forkboard")  # the review page in a checkout or the plugin
    for rel in OWNED:
        found += tree(top / rel)
    found += [top / ".claude" / "agents" / name for name in ROLES]
    claude = home("CLAUDE_HOME", ".claude")
    found += tree(claude / "skills" / "feature-flow") + [claude / "agents" / name for name in ROLES]
    found += tree(home("AGENTS_HOME", ".agents") / "skills" / "feature-flow")
    found += tree(home("FEATURE_FLOW_HOME", ".feature-flow"))
    return [path for path in found if not under(path, top / STATE_DIR)]


def state_files(top, feature):
    return [top / STATE_DIR / ("flow-%s.%s" % (feature, kind)) for kind in STATE_KINDS]


def under(path, folder):
    try:
        path.relative_to(folder)
        return True
    except ValueError:
        return False


def name(path, top):
    """In-repo paths relative and POSIX, others absolute POSIX."""
    return path.relative_to(top).as_posix() if under(path, top) else path.as_posix()


def hash_files(paths, top):
    """{name: sha256 of the file} for the paths that are files; a linked folder hashes as
    the sha256 of `link <its real path>`, and a link to nothing as `link <its target text>`,
    so swapping either is noticed."""
    each = {}
    for path in paths:
        if path.is_dir():
            each[name(path, top)] = link_hash(os.path.realpath(str(path)))
        elif path.is_file():
            try:
                each[name(path, top)] = hashlib.sha256(path.read_bytes()).hexdigest()
            except OSError:
                each[name(path, top)] = "unreadable"
        elif path.is_symlink():
            try:
                each[name(path, top)] = link_hash(os.readlink(str(path)))
            except OSError:
                each[name(path, top)] = "unreadable"
    return each


def link_hash(target):
    return hashlib.sha256(("link " + target).encode("utf-8", "surrogateescape")).hexdigest()


def snapshot(here, top, feature):
    """(code {name: sha256}, state {name: sha256})."""
    return hash_files(code_files(here, top), top), hash_files(state_files(top, feature), top)


def part(each):
    whole = hashlib.sha256()
    for key in sorted(each):
        whole.update(key.encode("utf-8") + b"\0" + each[key].encode("ascii") + b"\0")
    return whole.hexdigest()[:16]


def digest(code, state):
    return "%s.%s" % (part(code), part(state))


def trust_path(top, feature):
    return top / STATE_DIR / ("flow-%s.trust" % feature)


def changed(before, after):
    return sorted(key for key in set(before) | set(after) if before.get(key) != after.get(key))


def named_changes(top, feature, now):
    """The paths that differ from the per-file list the last call wrote. That list is untrusted:
    it only names paths once the digest has already decided to stop."""
    try:
        before = json.loads(trust_path(top, feature).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        before = None
    if not isinstance(before, dict):
        return "(no earlier list to name them)"
    names = changed(before, now)
    return ", ".join(names) if names else "(the earlier list names none of them)"


def replace_file(path, text):
    """Write a new regular file beside path and move it into place, so a symlink planted at path is replaced, never followed."""
    handle, temp = tempfile.mkstemp(dir=str(path.parent), prefix=".flow-trust-")
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as out:
            out.write(text)
        os.replace(temp, str(path))
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


def write_list(top, feature, each):
    folder = top / STATE_DIR
    folder.mkdir(parents=True, exist_ok=True)
    ignore = folder / ".gitignore"
    if ignore.is_symlink() or not ignore.is_file():
        replace_file(ignore, "*\n")
    replace_file(trust_path(top, feature), json.dumps(each, sort_keys=True, indent=1) + "\n")


def run_conductor(here, feature, command, rest):
    """Run flow.py isolated, with a fresh empty pycache_prefix so no planted .pyc is loaded."""
    cache = tempfile.mkdtemp(prefix="flow-trust-pycache-")
    try:
        args = [sys.executable, "-I", "-X", "pycache_prefix=" + cache, str(here / "flow.py"), feature, command] + rest
        return subprocess.run(args, env=dict(os.environ, FLOW_TRUSTED="1"),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    finally:
        shutil.rmtree(cache, ignore_errors=True)


def allows_flow_edit(top, ticket, sha):
    """True when the ticket's blob at sha has a `Floor:` line that lists flow-edit. Read with
    --no-replace-objects so a `git replace` cannot swap the blob. The Floor line is parsed as
    floorguard.allow_line does: the first one in the first 20 lines."""
    if not all(c in "0123456789abcdefABCDEF" for c in sha) or not 4 <= len(sha) <= 64:
        return False
    path = Path(ticket)
    if path.is_absolute():
        if not under(path.resolve(), top):
            return False
        path = path.resolve().relative_to(top)
    try:
        out = subprocess.run(["git", "--no-replace-objects", "cat-file", "blob", "%s:%s" % (sha, path.as_posix())],
                             cwd=str(top), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError:
        return False
    if out.returncode != 0:
        return False
    for line in out.stdout.decode("utf-8", "replace").split("\n")[:20]:
        if line.startswith("Floor:"):
            allow = re.sub(r"^floor:[ \t]*allow[ \t]*", "", line.lower(), count=1)
            return "flow-edit" in allow.replace(",", " ").split()
    return False


def flow_edit(top, feature, trust, after, code, state):
    """The code paths a flow-edit build may change, or None when the change is not accepted:
    the state part must match exactly, and the ticket at its base must allow flow-edit.
    The .trust list only names the paths."""
    if after is None or trust.split(".")[1:] != [part(state)]:
        return None
    if not allows_flow_edit(top, after[0], after[1]):
        return None
    return named_changes(top, feature, dict(code, **state))


def state_as_saved(report, state, top, feature):
    """True when the conductor's `flow-state <state> <findings>` line matches both files now."""
    fields = (report or "").split()
    if len(fields) != 3 or fields[0] != "flow-state":
        return False
    for path, said in zip(state_files(top, feature), fields[1:]):
        if (None if said == "none" else said) != state.get(name(path, top)):
            return False
    return True


def split_report(err):
    """(stderr without the conductor's final `flow-state` line, that line or None)."""
    lines = err.splitlines(True)
    if lines and lines[-1].startswith(b"flow-state "):
        return b"".join(lines[:-1]), lines[-1].strip().decode("ascii", "replace")
    return err, None


def with_digest(out, command, feature, trusted):
    """The conductor's stdout given the digest when it is the one-line `HANDOFF <invoke> <feature>`
    reply of `next`, so the next session can pass it as FLOW_TRUST on its first call. Any other
    output (a prompt that quotes such a line, say) is left alone. The line ending is kept."""
    text = out.rstrip(b"\r\n")
    if (command == "next" and text.startswith(b"HANDOFF ") and b"\n" not in text and b"\r" not in text
            and text.endswith(b" " + feature.encode("utf-8", "surrogateescape"))):
        return text + b" " + trusted.encode("ascii") + out[len(text):]
    return out


def main():
    here, args = started()
    parsed = parse(args)
    if parsed is None:
        print(USAGE)
        return 1
    feature, command, rest, after = parsed
    trust = os.environ.get("FLOW_TRUST", "")
    if not trust:
        print(NO_TRUST)
        return 1
    top = toplevel()
    before, state = snapshot(here, top, feature)
    edited = None
    if trust != "new" and digest(before, state) != trust:
        edited = flow_edit(top, feature, trust, after, before, state)
        if edited is None:
            if not trust_path(top, feature).is_file() and not any(path.exists() for path in state_files(top, feature)):
                print(NEW_FEATURE % feature)
            else:
                print(CHANGED % named_changes(top, feature, dict(before, **state)))
            return 1
    result = run_conductor(here, feature, command, rest)
    code, state = snapshot(here, top, feature)
    err, report = split_report(result.stderr)
    if code != before:
        stop = DURING % (command, ", ".join(changed(before, code)))
    elif result.returncode < 0:
        stop = KILLED % -result.returncode
    elif report is None:
        stop = NO_REPORT % command
    elif not state_as_saved(report, state, top, feature):
        stop = STATE_CHANGED % command
    else:
        stop = None
        write_list(top, feature, dict(code, **state))
    out = result.stdout
    if stop:
        sys.stdout.write(stop + "\n")
    else:
        trusted = digest(code, state)
        sys.stdout.write("TRUST %s\n" % trusted)
        if edited is not None:
            sys.stdout.write("FLOW-EDIT %s\n" % edited)
        out = with_digest(out, command, feature, trusted)
    sys.stdout.flush()
    sys.stdout.buffer.write(out)
    sys.stdout.buffer.flush()
    sys.stderr.buffer.write(err)
    sys.stderr.buffer.flush()
    return 1 if stop else result.returncode


if __name__ == "__main__":
    sys.exit(main())
