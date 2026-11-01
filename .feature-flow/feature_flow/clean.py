"""flow-status.py <feature> --clean [--yes]: the brainstorm's leftovers in the state folder, listed, then deleted.

Once the plan exists, the brainstorm's working files are spent: each helper's saved reply, the question files, the
helper counts, and the plain page when there is a live one. The final page is kept (the live folder, else the plain
page), and so is the brainstorm itself, which the plan carries. Without --yes it only lists; nothing outside
.feature-flow/state/ is touched, and a published page (an artifact) is never deleted here: the session deletes one
only when the user confirms it.
"""

import os
import shutil
from pathlib import Path

USAGE = "usage: python3 scripts/flow-status.py <feature> --clean [--yes]"


def leftovers(state, feature):
    """[paths] of the feature's spent brainstorm files in the state folder, in name order."""
    state = Path(state)
    live = state / ("brainstorm-%s-live" % feature)
    found = []
    for path in sorted(state.glob("brainstorm-%s-*.txt" % feature)) + sorted(state.glob("ask-%s-*.md" % feature)):
        found.append(path)
    for name in ("brainstorm-%s.helpers" % feature, "brainstorm-%s.html" % feature if live.is_dir() else None):
        if name and (state / name).is_file():
            found.append(state / name)
    return found


def main(argv, out, err):
    feature = argv[0] if argv else ""
    rest = argv[1:]
    if not feature or rest not in ([], ["--yes"]):
        err.write(USAGE + "\n")
        return 2
    plan = Path(os.environ.get("FLOW_DIR") or "plans") / feature
    if not plan.is_dir():
        err.write("no plan for %s yet: the brainstorm still needs its files. clean once the plan is accepted\n" % feature)
        return 1
    found = leftovers(Path(".feature-flow") / "state", feature)
    if not found:
        out.write("nothing to clean for %s\n" % feature)
        return 0
    for path in found:
        out.write(("deleted %s\n" if rest else "would delete %s\n") % path.as_posix())
        if rest:
            shutil.rmtree(str(path)) if path.is_dir() else path.unlink()
    if not rest:
        out.write("run again with --yes to delete them. the final page and the brainstorm stay\n")
    return 0
