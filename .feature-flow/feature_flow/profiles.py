"""Profiles: one word that sets several FLOW_ settings at once.

The word comes from FLOW_PROFILE, else from a `Profile:` line in the plan's commands.md (approved with
the plan, and frozen like the rest of it). A profile only fills settings that are not set: a FLOW_
variable given on the command line always wins. `normal` is the defaults. `standard` is what a new plan's
commands.md names: two reviewers side by side on each ticket, and one review of the whole round at the end.
"""

PROFILES = {
    "careful": {  # every ticket gets the full gate and its own two reviewers, shorter sessions
        "FLOW_GATE_FULL": "1",
        "FLOW_REVIEWERS": "2",
        "FLOW_ROUND_REVIEW": "on",
        "FLOW_BASE_GATE": "on",
        "FLOW_FAST": "0",
        "FLOW_SMALL_LINES": "0",
        "FLOW_TICKETS_PER_SESSION": "3",
    },
    "normal": {},
    "standard": {  # a quality and a ticket reviewer side by side on each ticket, one review of the whole round
        "FLOW_REVIEWERS": "2",
        "FLOW_ROUND_REVIEW": "on",
        "FLOW_BASE_GATE": "on",
    },
    "fast": {  # reviews below level 3 deferred to one feature review, no scouts, longer sessions
        "FLOW_FAST": "1",
        "FLOW_SCOUTS": "off",
        "FLOW_TICKETS_PER_SESSION": "6",
    },
}


class UnknownProfile(ValueError):
    pass


def pick(environ, commands_profile):
    """The profile's name, or "" for none."""
    name = (environ.get("FLOW_PROFILE") or commands_profile or "").strip().lower()
    if name and name not in PROFILES:
        raise UnknownProfile("the profile must be %s, not %s" % (", ".join(sorted(PROFILES)), name))
    return name


def apply(environ, name):
    """Fill the profile's settings into environ where they are not set; the keys it filled."""
    filled = []
    for key, value in PROFILES.get(name, {}).items():
        if not environ.get(key):
            environ[key] = value
            filled.append(key)
    return filled
