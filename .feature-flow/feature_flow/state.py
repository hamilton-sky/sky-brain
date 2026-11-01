"""The conductor's state and log, kept in .feature-flow/state/ at the top of the worktree.

Not under .git: a normal Codex session cannot write there, and an unattended Claude session is
refused there. The folder ignores itself (its .gitignore is `*`), so it never dirties the tree.
The state file is key=value lines. It is parsed as plain text, never run as code.
"""

import hashlib
import shutil
import time
from pathlib import Path

STATE_DIR = Path(".feature-flow") / "state"
KINDS = ("state", "log", "findings")
SEEN = {}  # "state"/"findings" -> the bytes this process last wrote or read there, None: no file


def _remember(kind, data):
    if kind is not None:
        SEEN[kind] = data


def reported():
    """`<state sha256 or none> <findings sha256 or none>` for the bytes this process left, as far as it knows."""
    return " ".join(hashlib.sha256(SEEN[k]).hexdigest() if SEEN.get(k) is not None else "none"
                    for k in ("state", "findings"))


def read_bytes(path, kind=None):
    """The file's bytes, or None when there is none; remembered for reported() under kind
    ("state" or "findings"), when given."""
    path = Path(path)
    data = path.read_bytes() if path.is_file() else None
    _remember(kind, data)
    return data


def read_text(path, kind=None):
    data = read_bytes(path, kind)
    return None if data is None else data.decode("utf-8")


def write_text(path, text, kind=None):
    data = text.encode("utf-8")
    Path(path).write_bytes(data)
    _remember(kind, data)


def remove(path, kind=None):
    path = Path(path)
    if path.is_file():
        path.unlink()
    _remember(kind, None)


def state_dir(top):
    """The state folder under the worktree top, created with its ignore rule on first use."""
    path = Path(top) / STATE_DIR
    path.mkdir(parents=True, exist_ok=True)
    ignore = path / ".gitignore"
    if not ignore.is_file():
        ignore.write_text("*\n", encoding="utf-8")
    return path


def file_path(folder, feature, kind):
    return Path(folder) / ("flow-%s.%s" % (feature, kind))


def state_path(folder, feature):
    return file_path(folder, feature, "state")


def log_path(folder, feature):
    return file_path(folder, feature, "log")


def migrate(old_folder, new_folder, feature):
    """Carry a run an earlier version kept under .git into the new folder, owner included, so the
    owning session keeps its token. Only when the new folder has no state for the feature yet.
    The state file is copied last, so a half-done copy is retried. The old files are left alone."""
    if old_folder is None or state_path(new_folder, feature).is_file():
        return False
    if not state_path(old_folder, feature).is_file():
        return False
    for kind in reversed(KINDS):
        old = file_path(old_folder, feature, kind)
        if old.is_file():
            shutil.copyfile(str(old), str(file_path(new_folder, feature, kind)))
    return True


def load(path, kind=None):
    data = {}
    text = read_text(path, kind)
    if text is None:
        return data
    for line in text.splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip():
            data[key.strip()] = value
    return data


def save(path, data, kind=None):
    path = Path(path)
    lines = ["%s=%s" % (key, str(value).replace("\n", " ")) for key, value in data.items()]
    tmp = path.with_name(path.name + ".tmp")
    out = ("\n".join(lines) + "\n").encode("utf-8")
    tmp.write_bytes(out)
    tmp.replace(path)
    _remember(kind, out)


def log(path, num, event):
    with open(path, "a", encoding="utf-8") as handle:
        handle.write("%s,%s,%s\n" % (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), num or "-", event))
