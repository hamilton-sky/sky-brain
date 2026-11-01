"""A lane ticket that passed and waits for its merge into the feature branch. No agent is handed anything for
it: the lane scheduler queues it when the ticket passes and merges it before it leases a new ticket."""

from feature_flow.conductor.errors import NoPhase
from feature_flow.conductor.phases.base import Outcome, Phase


class Merge(Phase):
    name = "merge"

    @classmethod
    def queue(cls, ws):
        """The ticket passed in its lane: it is counted once its merge lands."""
        ws.st["phase"] = cls.name
        ws.save()

    @classmethod
    def hand_out(cls, ws):
        raise NotImplementedError("a merge is queued by the lane scheduler, never handed out")

    @classmethod
    def judge(cls, ws):
        """Nothing to judge in the lane: None, so the lane scheduler's dispatch merges it."""
        return Outcome(None)

    @classmethod
    def scout_questions(cls, ws):
        raise NoPhase("no BUILD or REVIEW is pending for %s" % ws.feature)
