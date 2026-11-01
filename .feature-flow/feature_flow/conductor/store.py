"""The run state as typed views over the key=value file in .feature-flow/state/.

RunState is the whole run state: the dict `state.load` returns, with `num` and `save`. TicketState is one
ticket's view of it: the run's keys pass through, a lane's keys are stored as `L<k>.<key>`. Both work on
the same dict and the same file; the keys and the format never change. This module must not import
`feature_flow.lanes`, which re-exports RUN_KEYS and Scoped from here.
"""

from feature_flow import state
from feature_flow.conductor.errors import Stop

# the run's own state keys; every other key belongs to one lane and is stored as L<k>.<key>
RUN_KEYS = frozenset(("owner", "limit", "runs", "done", "session_done", "followups", "lanes", "relay_handoff",
                      "findings_for"))
NOTE_SEP = "\t"  # the state file keeps one line per key, so the review notes are tab separated


class Scoped:
    """One lane's view of the run state: its keys are stored as `L<k>.<key>`, the run's keys pass through."""

    def __init__(self, root, lane):
        self.root = root
        self.prefix = "L%d." % lane

    def key(self, key):
        return key if key in RUN_KEYS else self.prefix + key

    def get(self, key, default=None):
        return self.root.get(self.key(key), default)

    def __getitem__(self, key):
        return self.root[self.key(key)]

    def __setitem__(self, key, value):
        self.root[self.key(key)] = value

    def __contains__(self, key):
        return self.key(key) in self.root

    def setdefault(self, key, value):
        return self.root.setdefault(self.key(key), value)

    def update(self, values):
        for key, value in values.items():
            self[key] = value

    def clear(self):
        for key in [k for k in self.root if k.startswith(self.prefix)]:
            del self.root[key]


def number(value, key, path):
    """value as a whole number, empty as 0; a Stop naming the state file and the key when it is not one."""
    try:
        return int(value or 0)
    except ValueError:
        raise Stop("the state file %s is damaged: %s is not a number" % (path, key))


class RunState(dict):
    """The whole run state, read from and saved to path."""

    def __init__(self, path, data=()):
        super().__init__(data)
        self.path = path

    @classmethod
    def load(cls, path):
        try:
            return cls(path, state.load(path, "state"))
        except UnicodeDecodeError:
            raise Stop("the state file %s is damaged: it is not UTF-8 text" % path)

    def num(self, key):
        return number(self.get(key, "0"), key, self.path)

    def save(self):
        state.save(self.path, self, "state")


class TicketState(Scoped):
    """One ticket's view of a RunState: in lane k its keys are `L<k>.<key>`; outside lanes (lane 0) every
    key passes through."""

    def __init__(self, root, lane=0):
        super().__init__(root, lane)
        if not lane:
            self.prefix = ""

    def num(self, key):
        return number(self.get(key, "0"), key, self.root.path)
