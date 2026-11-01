"""feature-flow import <tasks.md or folder> <feature>: start a plan from a Spec Kit or OpenSpec task list.

usage: feature-flow import <path> <feature> [--dry-run]
<path> is a Spec Kit feature folder (specs/<NNN-name>/, with tasks.md), an OpenSpec change folder
(openspec/changes/<id>/, with tasks.md), or the tasks.md itself. It writes plans/<feature>/ the way
the planner would lay it out, one ticket per phase or numbered section, so the tasks stay small
items inside a ticket rather than becoming dozens of tickets:

- Blocked by: each section waits for the one before it. Spec Kit's user story phases ([US1], [US2], ...)
  wait only for the phases before the first story, so they can be built side by side, and the
  Polish phase waits for every story.
- Touches: the file paths named in the section's tasks, when every task names one.
- Done when: one item per task. No `check` block is invented: the run asks for one (flow-status --lint).
- spec.md carries the source's spec.md and plan.md (Spec Kit) or proposal.md and design.md (OpenSpec).
- commands.md is the template: the commands are the project's, so fill them in before building.

It never overwrites: an existing plans/<feature>/ is refused. Nothing is committed.
"""

import os
import re
import sys
from pathlib import Path

from feature_flow import git

USAGE = "usage: feature-flow import <spec-kit or openspec folder, or its tasks.md> <feature> [--dry-run]"
TASK = re.compile(r"^\s*[-*]\s+\[[ xX]\]\s+(.*\S)\s*$")
HEADING = re.compile(r"^(#{2,4})\s+(.*\S)\s*$")
SPECKIT_ID = re.compile(r"^T\d{3,}\b\s*")
OPENSPEC_ID = re.compile(r"^\d+(\.\d+)+\s+")
MARKERS = re.compile(r"\[(P|US\d+)\]\s*")
STORY = re.compile(r"\[(US\d+)\]")
PATHISH = re.compile(r"(?<![\w/.-])((?:[\w.-]+/)+[\w.-]+\.\w+|(?:[\w.-]+/)+)(?![\w/])")


def find_tasks(path):
    """(tasks.md path, the kind: speckit | openspec | tasks)."""
    path = Path(path)
    tasks = path / "tasks.md" if path.is_dir() else path
    if not tasks.is_file():
        return None, None
    folder = tasks.parent
    if (folder / "proposal.md").is_file() or "openspec" in folder.parts:
        return tasks, "openspec"
    if (folder / "spec.md").is_file() or (folder / "plan.md").is_file() or "specs" in folder.parts:
        return tasks, "speckit"
    return tasks, "tasks"


def sections(text):
    """[(title, [task text])] for each heading that holds at least one checkbox task."""
    out, title, items = [], "Tasks", []
    for line in text.splitlines():
        heading = HEADING.match(line)
        if heading:
            if items:
                out.append((title, items))
            title, items = heading.group(2).strip(), []
            continue
        task = TASK.match(line)
        if task:
            items.append(task.group(1))
    if items:
        out.append((title, items))
    return out


def clean(task):
    """The task without its T001 / 1.2 id, keeping [P] and [USn] out of the sentence."""
    task = SPECKIT_ID.sub("", task)
    task = OPENSPEC_ID.sub("", task)
    return MARKERS.sub("", task).strip()


def story(items):
    found = {m.group(1) for item in items for m in STORY.finditer(item)}
    return sorted(found)[0] if len(found) == 1 else None


def paths(items):
    """The repo paths the tasks name; [] unless every task names at least one."""
    found = []
    for item in items:
        here = [p for p in PATHISH.findall(clean(item)) if not p.startswith(("http", "www."))]
        if not here:
            return []
        found += [p for p in here if p not in found]
    return found


def slug(title):
    words = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    words = re.sub(r"^(phase-\d+-|\d+-)", "", words)
    return "-".join(words.split("-")[:6]) or "tasks"


def blockers(parts, kind):
    """Blocked by numbers per section (1-based), from the order and, for Spec Kit, the user stories."""
    stories = [story(items) for _, items in parts]
    first_story = next((i for i, s in enumerate(stories) if s), None)
    out = []
    for i, (title, _) in enumerate(parts):
        if i == 0:
            out.append([])
        elif kind == "speckit" and first_story is not None and stories[i] and i > first_story:
            out.append([first_story] if first_story > 0 else [])  # stories wait for the phases before them
        elif kind == "speckit" and first_story is not None and i > first_story and not stories[i]:
            out.append([j + 1 for j in range(first_story, i) if stories[j]] or [i])  # polish waits for the stories
        else:
            out.append([i])
    return out


def ticket(title, items, blocked, kind, source):
    touched = paths(items)
    lines = [
        "# %s" % title,
        "",
        "Type: task",
        "Status: open",
        "Blocked by: %s" % (", ".join("%02d" % n for n in blocked) or "—"),
        "Test first: no",
        "Level: 2",
    ]
    if touched:
        lines.append("Touches: %s" % ", ".join(touched))
    lines += [
        "",
        "Imported from %s (%s). Build every task below; together they are this ticket." % (source, kind),
        "",
        "## Not in this ticket",
        "",
        "- The other sections of the source task list: they are their own tickets.",
        "",
        "## Done when",
        "",
    ]
    lines += ["- %s" % clean(item) for item in items]
    lines += ["", "## Answer", ""]
    return "\n".join(lines)


def spec_text(folder, kind, feature):
    names = {"speckit": ("spec.md", "plan.md"), "openspec": ("proposal.md", "design.md")}.get(kind, ())
    parts = ["# Spec: %s" % feature, "", "Imported from `%s`." % folder.as_posix()]
    for name in names:
        source = folder / name
        if source.is_file():
            body = source.read_text(encoding="utf-8", errors="replace").strip()
            parts += ["", "## From %s" % name, "", re.sub(r"^#", "###", body, flags=re.M)]
    return "\n".join(parts) + "\n"


def template(root, name, feature):
    path = root / "guides" / "templates" / name
    if path.is_file():
        return path.read_text(encoding="utf-8").replace("<feature>", feature)
    return "# %s: %s\n" % (name[:-3].capitalize(), feature)


def build(path, feature, guides_root):
    """{relative path: text} for the new plan folder, or an error string."""
    tasks, kind = find_tasks(path)
    if tasks is None:
        return "no tasks.md at %s" % path
    parts = sections(tasks.read_text(encoding="utf-8", errors="replace"))
    if not parts:
        return "no checkbox tasks (- [ ] ...) in %s" % tasks
    folder = tasks.parent
    source = tasks.as_posix()
    files = {"spec.md": spec_text(folder, kind, feature),
             "map.md": "# Map: %s\n\n## Destination\n\nWhat %s describes, built ticket by ticket.\n\n"
                       "## Decisions so far\n\n<One line per resolved ticket.>\n" % (feature, source),
             "learnings.md": "# Learnings: %s\n\n- (NN) <what you found>\n" % feature,
             "commands.md": template(guides_root, "commands.md", feature)}
    for index, ((title, items), blocked) in enumerate(zip(parts, blockers(parts, kind)), 1):
        files["tasks/%02d-%s.md" % (index, slug(title))] = ticket(title, items, blocked, kind, source)
    return files


def guides_home(top):
    """The folder whose guides/templates/ this install uses: beside the package (a checkout, or .feature-flow/
    in a repo install), the package's own bundle, else the repo's .feature-flow/."""
    here = Path(__file__).resolve().parent
    for root in (here.parent, here / "_bundle"):
        if (root / "guides" / "templates").is_dir():
            return root
    return Path(top) / ".feature-flow"


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
    plan = Path(top) / os.environ.get("FLOW_DIR", "plans") / feature
    if plan.exists():
        err.write("%s already exists: import only starts a new plan\n" % plan)
        return 1
    files = build(path, feature, Path(guides_root) if guides_root else guides_home(top))
    if isinstance(files, str):
        err.write(files + "\n")
        return 1
    for rel, text in sorted(files.items()):
        out.write("%s %s\n" % ("would write" if dry else "wrote", (plan / rel).relative_to(top).as_posix()))
        if not dry:
            (plan / rel).parent.mkdir(parents=True, exist_ok=True)
            (plan / rel).write_text(text, encoding="utf-8")
    if not dry:
        out.write("next: fill in plans/%s/commands.md (Build, Test, Smoke), add a ```check block under each "
                  "ticket's Done when, set the levels, then flow-status.py %s --lint, commit the folder, and "
                  "/feature-flow %s\n" % (feature, feature, feature))
    return 0
