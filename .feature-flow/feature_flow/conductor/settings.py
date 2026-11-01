"""The run settings, read once from the environment, the profile and commands.md, and MODE_RULES, the one
table of which modes may run together.

Validation stays lazy: Settings reads only what `Conductor.__init__` always read, in the same order, and
each mode rule is asked where its check ran before (`start`, `lane_next`, `batch_for`).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional, Tuple

from feature_flow import brainstorm_mode, profiles, state, tickets
from feature_flow.conductor.errors import Stop


MAX_LANES = 4
MAX_BATCH = 5  # most tickets one builder takes at once in fast mode
EACH, END = 1, 0  # gate_every: the full gate and a review after each ticket, or one checkpoint at the end
GATE_DEFAULTS = {"fast": "end", "standard": "batch 3", "careful": "each"}  # a profile's Gate: when the plan names none
MAX_GATE_BATCH = 20


def gate_every(value, profile):
    """commands.md's Gate: line as (gate on, gate_every): gate_every is EACH (1), N for `batch N`, or END (0).
    "" and `on` take the profile's default (each without one); `off unsafe` turns the gate off. A ValueError
    names the forms for any other value."""
    value = " ".join(value.lower().split())
    if value == "off unsafe":
        return False, EACH
    if value in ("", "on"):
        value = GATE_DEFAULTS.get(profile, "each")
    if value == "each":
        return True, EACH
    if value == "end":
        return True, END
    if value.startswith("off"):
        raise ValueError("commands.md's Gate: line turns the gate off only as `Gate: off unsafe`, not %s" % value)
    words = value.split()
    if len(words) == 2 and words[0] == "batch" and words[1].isdigit() and 1 <= int(words[1]) <= MAX_GATE_BATCH:
        return True, int(words[1])
    raise ValueError("commands.md's Gate: line must be each, batch N (N from 1 to %d), end, or off unsafe to turn "
                     "the gate off, not %s" % (MAX_GATE_BATCH, value))


def _env_int(name, default, environ=None):
    environ = os.environ if environ is None else environ
    value = environ.get(name, "")
    try:
        return int(value) if value.strip() else default
    except ValueError:
        raise Stop("%s must be a whole number, not %s" % (name, value))


def _reviewers(environ):
    value = _env_int("FLOW_REVIEWERS", 1, environ)
    if value not in (1, 2):
        raise Stop("FLOW_REVIEWERS must be 1 or 2, not %d" % value)
    return value


@dataclass(frozen=True)
class Settings:
    root: Path
    profile: str
    filled: Tuple[str, ...]  # the keys the profile filled into the environment
    max_retries: int
    max_rounds: int
    gate_timeout: int
    gate_on: bool
    gate_every: int  # EACH: checks and a review after each ticket; N: a checkpoint every N tickets; END: at the end
    per_session: int  # FLOW_TICKETS_PER_SESSION as read; session_limit applies the agent-driver rule
    per_session_given: bool  # FLOW_TICKETS_PER_SESSION was set, and not by the profile
    small_files: int
    small_lines: int
    batch_size: int
    scouts_on: bool
    relay: bool
    invoke: str
    reviewers: int = 1  # 2: a quality and a ticket reviewer side by side, where one review would run
    round_review: bool = False  # one review of the whole round at the end, after every ticket's own
    base_gate: bool = False  # the whole gate once at the base, before the first ticket
    scout_code: str = "normal"  # off, light, normal or deep: how far the code scouts (flow-scout) look
    scout_web: str = "normal"  # the same for the web scouts (flow-web)
    brainstorm_type: str = ""  # the brainstorm's Type: line, "" without one
    brainstorm_helpers: tuple = None  # the helpers its Helpers: line picks; None without one: any, up to the caps

    @classmethod
    def load(cls, feature, environ=None):
        """The settings of feature's run. Stops on the first bad value, in the order the conductor always
        checked them: the profile, the scout levels, then the whole numbers. Fills the profile's settings into environ."""
        environ = os.environ if environ is None else environ
        root = Path(environ.get("FLOW_DIR") or "plans")
        try:
            profile = profiles.pick(environ, tickets.commands_value(root / feature / "commands.md", "Profile"))
        except profiles.UnknownProfile as err:
            raise Stop(str(err))
        filled = profiles.apply(environ, profile)
        try:
            plan_gate, every = gate_every(tickets.commands_value(root / feature / "commands.md", "Gate"), profile)
        except ValueError as err:
            raise Stop(str(err))
        try:
            mode = brainstorm_mode.read(root, state.STATE_DIR, feature)
            code, web = (brainstorm_mode.level(kind, environ, filled, mode) for kind in brainstorm_mode.KINDS)
        except brainstorm_mode.BadMode as err:
            raise Stop("%s. fix the header of the brainstorm of %s" % (err, feature))
        return cls(
            root=root,
            profile=profile,
            filled=tuple(filled),
            max_retries=_env_int("FLOW_MAX_RETRIES", 2, environ),
            max_rounds=_env_int("FLOW_MAX_REVIEW_ROUNDS", 3, environ),
            gate_timeout=_env_int("FLOW_GATE_TIMEOUT", 30, environ),
            gate_on=environ.get("FLOW_GATE", "on") != "off" and plan_gate,
            gate_every=every,
            per_session=_env_int("FLOW_TICKETS_PER_SESSION", 4, environ),
            per_session_given=bool(environ.get("FLOW_TICKETS_PER_SESSION"))
            and "FLOW_TICKETS_PER_SESSION" not in filled,
            small_files=_env_int("FLOW_SMALL_FILES", 3, environ),
            small_lines=_env_int("FLOW_SMALL_LINES", 60, environ),
            batch_size=min(_env_int("FLOW_BATCH", MAX_BATCH, environ), MAX_BATCH),
            scouts_on=(code, web) != ("off", "off"),
            relay=environ.get("FLOW_RELAY", "0") == "1",
            invoke=environ.get("FLOW_INVOKE") or "/feature-flow",
            reviewers=_reviewers(environ),
            round_review=environ.get("FLOW_ROUND_REVIEW", "off") == "on",
            base_gate=environ.get("FLOW_BASE_GATE", "off") == "on",
            scout_code=code,
            scout_web=web,
            brainstorm_type=mode.get("type", ""),
            brainstorm_helpers=mode.get("helpers"),
        )

    def session_limit(self, driver):
        """Tickets per session for this driver: an agent has no context to refresh between sessions, so it
        gets no handoffs (0) unless FLOW_TICKETS_PER_SESSION was given for the run itself."""
        if driver == "agent" and not self.per_session_given:
            return 0
        return self.per_session


@dataclass(frozen=True)
class ModeRule:
    name: str
    broken: Callable[[dict], bool]  # the facts -> True when the modes may not run together
    stop: Optional[str]  # the STOP text, filled from the facts, or None when the mode is quietly skipped


MODE_RULES = (
    ModeRule("lanes_range", lambda f: not 1 <= f["lanes"] <= MAX_LANES,
             "FLOW_LANES must be 1 to %d, not %%(lanes)d" % MAX_LANES),
    ModeRule("lanes_relay", lambda f: f["lanes"] > 1 and f["relay"],
             "FLOW_RELAY hands off after every phase, which lanes cannot do. drop one of them"),
    ModeRule("lanes_top", lambda f: f["lanes"] > 1 and f["cwd"] != f["top"],
             "run the conductor from the top of the repo (%(top)s) to use lanes"),
    ModeRule("driver", lambda f: f["driver"] not in ("", "person", "agent"),
             "FLOW_DRIVER must be person or agent, not %(driver)s"),
    ModeRule("fast", lambda f: f["fast"] not in ("", "0", "1"),
             "FLOW_FAST must be 1 or 0, not %(fast)s"),
    ModeRule("batch", lambda f: (f["size"] < 2 or not f["fast_mode"] or not f["gate_on"] or f["relay"]
                                 or f["lanes"] > 1),
             None),
)


def mode_ok(name, **facts):
    """True when rule name holds for facts; when it is broken, raise its STOP, or return False if it has none."""
    rule = {rule.name: rule for rule in MODE_RULES}[name]
    if not rule.broken(facts):
        return True
    if rule.stop is None:
        return False
    raise Stop(rule.stop % facts)
