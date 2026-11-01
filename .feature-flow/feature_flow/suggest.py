"""Did-you-mean hints for a mistyped command or feature name."""

import difflib
import os


def closest(word, choices):
    """The choice nearest to word, or "" when none is close."""
    found = difflib.get_close_matches(word, list(choices), n=1, cutoff=0.6)
    return found[0] if found else ""


def features(root):
    """The plan folders under root (plans/ or FLOW_DIR)."""
    try:
        return sorted(name for name in os.listdir(str(root)) if os.path.isdir(os.path.join(str(root), name)))
    except OSError:
        return []


def hint(word, choices, template="did you mean: %s?"):
    match = closest(word, choices)
    return (template % match + "\n") if match else ""
