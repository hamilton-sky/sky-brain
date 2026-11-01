"""A fingerprint of the code and prompt files a conductor run uses, so a change during a build shows."""

import hashlib
import json
import os
from pathlib import Path

from feature_flow import git, prompts

# feature-flow's own scripts; any other .py file in the same folder is the repo's own code
SCRIPTS = ("flow.py", "flow-status.py", "gate.py", "floor-guard.py", "flow-view.py", "flow-trust.py")


def _files(scripts):
    package = Path(__file__).resolve().parent
    found = [p for p in package.rglob("*.py") if "__pycache__" not in p.parts]
    folder = Path(scripts).resolve()
    found += [folder / name for name in SCRIPTS if (folder / name).is_file()]
    for phase in ("build", "review", "review-quality", "review-single", "review-feature", "test"):
        for folder, names in (("agents", prompts.ROLES), ("guides", prompts.GUIDES)):
            try:
                found.append(prompts.find_file(scripts, folder, names[phase]).resolve())
            except FileNotFoundError:
                pass
    for name in ("flow-scout.md", "flow-web.md", "flow-architect.md", "flow-designer.md", "flow-po.md"):  # also in prompts
        try:
            found.append(prompts.find_file(scripts, "agents", name).resolve())
        except FileNotFoundError:
            pass
    try:
        found.append(prompts.find_file(scripts, "guides", "debug.md").resolve())
    except FileNotFoundError:
        pass
    return sorted(set(found))


def _name(path, top):
    try:
        return path.relative_to(top).as_posix()
    except ValueError:
        return path.as_posix()


def flow_code(scripts, cwd=None):
    """(the sha256 over every file's path and bytes, {path relative to the repo: sha256 of the file}); the repo
    is the one cwd is in (None: the working folder), and a file outside it is named by its absolute path."""
    top = git.toplevel(cwd=cwd)
    top = top.resolve() if top is not None else Path(cwd if cwd is not None else os.getcwd()).resolve()
    each = {}
    for path in _files(scripts):
        try:
            each[_name(path, top)] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            each[_name(path, top)] = ""
    whole = hashlib.sha256()
    for name in sorted(each):
        whole.update(name.encode("utf-8") + b"\0" + each[name].encode("ascii") + b"\0")
    return whole.hexdigest(), each


def changed(before, now):
    """The names that differ between two {name: sha256} maps, sorted."""
    return sorted(name for name in set(before) | set(now) if before.get(name) != now.get(name))


def dump(each):
    return json.dumps(each, sort_keys=True)


def load(text):
    try:
        value = json.loads(text)
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}
