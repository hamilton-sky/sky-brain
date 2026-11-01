"""Builder notes: a ticket's `Builder: <name>` line adds guides/builders/<name>.md to its build prompt.

There is one builder agent (ticket-builder). A note only tells it what to watch for in that kind of code; it adds to
the build guide and never overrides it. The planner suggests a name from the ticket's `Touches:` paths, and the
plan's page lets the person switch it before the plan is accepted.
"""

import re
from pathlib import Path

NAMES = ("frontend", "backend", "docs")
FRONTEND = re.compile(r"(^|/)(frontend|web|ui|components|pages|styles|static|public)/|\.(tsx|jsx|vue|svelte|css|scss|html)$")
DOCS = re.compile(r"(^|/)docs?/|\.(md|rst|txt)$|(^|/)README")


def suggest(touches):
    """The builder a ticket's Touches: paths point to, or None when they are mixed, missing or plain tests."""
    kinds = set()
    for path in touches or ():
        p = path.strip().lower()
        if FRONTEND.search(p):
            kinds.add("frontend")
        elif DOCS.search(p):
            kinds.add("docs")
        elif re.search(r"(^|/)tests?/|(^|/)test_[^/]*$|\.(test|spec)\.\w+$", p):
            continue  # tests ride with the code they cover, so they say nothing about the kind
        else:
            kinds.add("backend")
    return kinds.pop() if len(kinds) == 1 else None


def ticket_builder(path):
    """The `Builder:` name in the first 20 lines of the ticket at path, or None."""
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()[:20]
    except OSError:
        return None
    for line in lines:
        if line.startswith("Builder:"):
            return (line[len("Builder:"):].strip().split() or [""])[0].strip("`").lower() or None
    return None
