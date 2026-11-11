"""flow-status.py <feature> --fix <diagnosis.md> [--dry-run]: start a one-ticket plan that fixes a bug.

The fix path (guides/fix.md) skips the brief, the planner and the plan reviewer. The session reproduces the bug,
finds its cause without changing anything, and writes what it found into a diagnosis file:

    # Fix: <one line: what is broken>

    Repro: `<a read-only command that fails now and passes once the bug is fixed>`
    Expect: <optional: `prints <text>` the fixed output must contain>
    Touches: <the paths the fix changes, tests included, comma separated>
    Level: <optional: 1, 2 (the default) or 3>
    Cause: <the root cause, one paragraph>
    Fix: <the change that removes the cause, one paragraph>

    ## Evidence

    <the commands run and what they printed, the code read>

This writes plans/<feature>/ from it: spec.md (the bug, the cause, the evidence), map.md, learnings.md,
commands.md (the command lines of the newest plan in the repo, else the template) and one ticket,
`Type: fix`, `Test first: yes`, whose check block runs the Repro command. The builder of a fix ticket gets the
debugging guide from its first attempt. It never overwrites: an existing plans/<feature>/ is refused, and
nothing is committed.
"""

import os
import re
import sys
from pathlib import Path

from feature_flow import git, importer

USAGE = "usage: python3 scripts/flow-status.py <feature> --fix <diagnosis.md> [--dry-run]"
HEADER = re.compile(r"^(Repro|Expect|Touches|Level|Cause|Fix):[ \t]*(.*?)\s*$")
TITLE = re.compile(r"^#\s+(?:Fix:\s*)?(.*\S)\s*$")
# command lines worth carrying from another plan: the project's own commands, never that plan's choices
CARRY = re.compile(r"^(Build|Test|Quick|Lint|Typecheck|Security|Smoke|Setup|Sensitive|Check [^:]+):[ \t]*`([^`<][^`]*)`")


def parse(text):
    """{title, repro, expect, touches, level, cause, fix, evidence}, or an error string."""
    found = {"title": "", "evidence": ""}
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if not found["title"] and TITLE.match(line):
            found["title"] = TITLE.match(line).group(1)
            continue
        m = HEADER.match(line)
        if m and m.group(1).lower() not in found:
            found[m.group(1).lower()] = m.group(2)
        if line.strip().lower() == "## evidence":
            found["evidence"] = "\n".join(lines[i + 1:]).strip()
            break
    missing = [k for k in ("title", "repro", "touches", "cause", "fix") if not found.get(k)]
    if missing:
        return "the diagnosis has no %s line (see guides/fix.md)" % ", ".join(
            "title (# Fix: ...)" if k == "title" else k.capitalize() + ":" for k in missing)
    repro = found["repro"].strip()
    if not (repro.startswith("`") and repro.endswith("`") and len(repro) > 2):
        return "Repro: must be one command in backticks, not %s" % repro
    found["repro"] = repro[1:-1].strip()
    level = (found.get("level") or "2").strip().strip("`")
    if level not in ("1", "2", "3"):
        return "Level: must be 1, 2 or 3, not %s" % level
    found["level"] = level
    expect = (found.get("expect") or "").strip().strip("`")
    if expect and not expect.startswith("prints "):
        return "Expect: must be `prints <text>`, not %s" % expect
    found["expect"] = expect
    found["touches"] = ", ".join(p.strip().strip("`") for p in found["touches"].split(",") if p.strip())
    return found


def commands(top, plans, feature, guides_root):
    """commands.md for the fix: the newest other plan's command lines when there is one, else the template."""
    newest = None
    for path in sorted(Path(top, plans).glob("*/commands.md")):
        if path.parent.name != feature and (newest is None or path.stat().st_mtime > newest.stat().st_mtime):
            newest = path
    carried = []
    if newest is not None:
        carried = [line.rstrip() for line in newest.read_text(encoding="utf-8", errors="replace").splitlines()
                   if CARRY.match(line)]
    if not any(line.startswith(("Build:", "Test:")) for line in carried):
        return importer.template(guides_root, "commands.md", feature).replace(
            "Profile: `standard`", "Profile: `normal`"), None
    text = ("# Commands: %s\n\nThe command lines of %s, for a one-ticket fix. Approved by a human with the fix; "
            "workers must not change it. `normal` gives the ticket the full gate and its own review.\n\n%s\n"
            "Profile: `normal`\n" % (feature, newest.relative_to(top).as_posix(), "\n".join(carried)))
    return text, newest.relative_to(top).as_posix()


def ticket(d):
    check = ["```check", "$ %s" % d["repro"]]
    check.append(d["expect"] or "exit 0")
    check.append("```")
    lines = [
        "# Fix: %s" % d["title"],
        "",
        "Type: fix",
        "Status: open",
        "Blocked by: —",
        "Test first: yes",
        "Level: %s" % d["level"],
        "Touches: %s" % d["touches"],
        "",
        "A bug fix. The diagnosis is in spec.md: reproduce it first with the command below, then fix the cause, "
        "not the symptom.",
        "",
        "Cause: %s" % d["cause"],
        "",
        "Fix: %s" % d["fix"],
        "",
        "## Not in this ticket",
        "",
        "- Anything the bug does not need: tidying, renames, other bugs found on the way (put those in learnings.md).",
        "",
        "## Done when",
        "",
        "- A regression test that fails on the bug, committed on its own before the fix (test first).",
        "- `%s` %s." % (d["repro"], "prints %s" % d["expect"][len("prints "):] if d["expect"] else "exits 0"),
        "- All existing tests still pass.",
        "",
    ] + check + ["", "## Reference", "", "- spec.md, the diagnosis", "", "## Answer", ""]
    return "\n".join(lines)


def build(text, feature, top, plans, guides_root):
    """({relative path: text}, the plan whose commands were carried or None), or an error string."""
    d = parse(text)
    if isinstance(d, str):
        return d
    spec = ["# Spec: %s" % feature, "", "A one-ticket bug fix, from the session's diagnosis (guides/fix.md).", "",
            "## The bug", "", d["title"], "", "## Reproduce", "", "```", d["repro"], "```", "",
            "It fails now. Once fixed it %s." % ("prints %s" % d["expect"][len("prints "):] if d["expect"] else "exits 0"),
            "", "## Cause", "", d["cause"], "", "## Fix", "", d["fix"]]
    if d["evidence"]:
        spec += ["", "## Evidence", "", d["evidence"]]
    cmds, carried = commands(top, plans, feature, guides_root)
    files = {"spec.md": "\n".join(spec) + "\n",
             "map.md": "# Map: %s\n\n## Destination\n\nThe bug in spec.md is fixed, with a regression test.\n\n"
                       "## Decisions so far\n\n<One line per resolved ticket.>\n" % feature,
             "learnings.md": "# Learnings: %s\n\n- (NN) <what you found>\n" % feature,
             "commands.md": cmds,
             "tasks/01-fix-%s.md" % importer.slug(d["title"]): ticket(d)}
    return files, carried


def main(argv, out=None, err=None, guides_root=None):
    out = out or sys.stdout
    err = err or sys.stderr
    dry = "--dry-run" in argv
    args = [a for a in argv if a != "--dry-run"]
    if len(args) != 2 or any(a.startswith("-") for a in args) or any(c in args[1] for c in "/\\:"):
        err.write(USAGE + "\n")
        return 2
    path, feature = args
    top = git.toplevel()
    if top is None:
        err.write("not inside a git repo\n")
        return 2
    plans = os.environ.get("FLOW_DIR", "plans")
    plan = Path(top) / plans / feature
    if plan.exists():
        err.write("%s already exists: --fix only starts a new plan\n" % plan)
        return 1
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        err.write("cannot read the diagnosis %s: %s\n" % (path, e.strerror))
        return 1
    result = build(text, feature, top, plans, Path(guides_root) if guides_root else importer.guides_home(top))
    if isinstance(result, str):
        err.write(result + "\n")
        return 1
    files, carried = result
    for rel, body in sorted(files.items()):
        out.write("%s %s\n" % ("would write" if dry else "wrote", (plan / rel).relative_to(top).as_posix()))
        if not dry:
            (plan / rel).parent.mkdir(parents=True, exist_ok=True)
            (plan / rel).write_text(body, encoding="utf-8")
    if carried:
        out.write("commands from %s: check them with the user\n" % carried)
    else:
        out.write("no other plan has commands: fill in %s/%s/commands.md (Build, Test, Smoke) with the user\n"
                  % (plans, feature))
    if not dry:
        out.write("next: flow-status.py %s --lint, show the ticket, and on the user's yes commit the folder as "
                  "docs(%s): fix plan, then /feature-flow %s\n" % (feature, feature, feature))
    return 0
