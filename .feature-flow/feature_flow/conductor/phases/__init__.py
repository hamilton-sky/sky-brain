"""The phases of a ticket and of the run, found through one registry."""

from feature_flow.conductor.phases.ask import Ask
from feature_flow.conductor.phases.base import Outcome, Phase
from feature_flow.conductor.phases.build import Build
from feature_flow.conductor.phases.final import Final
from feature_flow.conductor.phases.merge import Merge
from feature_flow.conductor.phases.review import Review
from feature_flow.conductor.phases.test import Test

REGISTRY = {cls.name: cls for cls in (Build, Review, Ask, Test, Final, Merge)}

# Which phase may follow which. "" is between tickets (and the end of the run); "merge" is a lane ticket that
# passed and waits for its merge. A phase follows itself when it is handed out again: a retry, a send-back, the
# quality pass after the spec pass.
TRANSITIONS = {
    "": ("", "build", "test", "final"),
    "build": ("build", "review", "ask", "", "merge"),
    "review": ("review", "build", "ask", "", "merge"),
    "ask": ("ask", "build", "review"),
    "test": ("test", ""),
    "final": ("final", ""),
    "merge": ("", "build", "review"),
}

__all__ = ["REGISTRY", "TRANSITIONS", "Outcome", "Phase", "Build", "Review", "Ask", "Test", "Final", "Merge"]
