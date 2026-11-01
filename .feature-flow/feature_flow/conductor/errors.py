"""The two ways a conductor command ends early: a STOP the session reports, or nothing pending."""


class Stop(Exception):
    """A problem the session must report. Printed as `STOP <reason>`, exit 1."""


class NoPhase(Exception):
    """`prompt` or `verdict` with nothing for it pending: nothing changes, exit 2."""
