"""How much rework a ticket gets. Pure: values in, values out."""

from __future__ import annotations


def round_cap(level, max_rounds):
    """The send-back rounds a ticket of this level may have: 1 at level 1, else max_rounds."""
    return min(1, max_rounds) if level == 1 else max_rounds


CHECK_ROUNDS = 3  # send-backs from the conductor's own checks (gate, floor guard, footprint, Done when, test first)


def cap_of(kind, level, max_rounds):
    """The send-backs of this kind a ticket may have: its checks have their own count, so a flaky test does not
    use up its review rounds."""
    return CHECK_ROUNDS if kind == "check" else round_cap(level, max_rounds)
