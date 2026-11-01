"""The state machine that tells an interactive session what to do next.

It sets the limits, retries and review rounds. It judges every phase from the repo, never from the
caller, and prints exactly one line per command.
"""

import contextlib
import os
import secrets
import time
from pathlib import Path

from feature_flow import codehash, git, state
from feature_flow.conductor import budget as time_budget
from feature_flow.conductor import guards, reset as run_reset
from feature_flow.conductor.errors import NoPhase, Stop
from feature_flow.conductor.guards import owner_hash  # the package exports it
from feature_flow.conductor.phases import REGISTRY
from feature_flow.conductor.planning import Planner, one_scout
from feature_flow.conductor.policy.review import followups_only
from feature_flow.conductor.replies import demote, prompt_files, section_after  # the package exports them
from feature_flow.conductor.schedulers import BatchScheduler, LaneScheduler
from feature_flow.conductor.settings import Settings, mode_ok
from feature_flow.conductor.store import RunState
from feature_flow.conductor.workspace import Workspace


class Conductor(Workspace):
    """The facade of the CLI commands, and the main worktree's Workspace."""

    def __init__(self, feature, scripts):
        self.feature = feature
        self.scripts = Path(scripts)
        self.settings = settings = Settings.load(feature)
        self.root = settings.root
        self.plan = self.root / feature
        self.commands = self.plan / "commands.md"
        self.profile = settings.profile
        self.max_retries = settings.max_retries
        self.max_rounds = settings.max_rounds
        self.gate_timeout = settings.gate_timeout
        self.gate_on = settings.gate_on
        self.per_session = settings.per_session
        self.small_files = settings.small_files
        self.small_lines = settings.small_lines
        self.batch_size = settings.batch_size
        self.checks_ran = False
        self.scouts_on = settings.scouts_on
        self.relay = settings.relay
        self.invoke = settings.invoke
        self.reviewers = settings.reviewers
        self.round_review = settings.round_review
        top = git.toplevel()
        if top is None:
            raise Stop("not inside a git worktree")
        self.top = top.resolve()
        try:
            folder = state.state_dir(top)
            state.migrate(git.git_dir(), folder, feature)
        except OSError as err:
            raise Stop("cannot write the flow state in %s: %s. this session must be allowed to write there"
                       % (top / state.STATE_DIR, err.strerror or err))
        self.draft_root = state.STATE_DIR / "draft"
        self.draft = self.draft_root / feature
        self.brief_file = state.STATE_DIR / ("brief-%s.md" % feature)
        self.brainstorm_file = state.STATE_DIR / ("brainstorm-%s.md" % feature)
        self.state_file = state.state_path(folder, feature)
        self.log_file = state.log_path(folder, feature)
        self.findings_file = state.file_path(folder, feature, "findings")
        state.read_bytes(self.findings_file, "findings")  # so a call that never touches it still reports it
        self.all = RunState.load(self.state_file)  # the whole run state
        Workspace.__init__(self, self)  # the main worktree: the run's state view, no lane
        self.per_session = settings.session_limit(self.driver())  # an agent driver: no handoffs
        self.sched = None  # the scheduler, picked once per call by scheduler()

    # ---- small helpers -------------------------------------------------

    def driver(self):
        """Who drives the run: "agent" (an orchestrating agent, FLOW_DRIVER=agent on start) or "person"."""
        return os.environ.get("FLOW_DRIVER") or self.all.get("driver") or "person"

    # ---- the fast path: reviews deferred to one review of the whole feature --

    def fast(self):
        return self.all.get("fast") == "1"

    def deferred(self):
        """[(NN, base)] of the tickets that passed their checks in fast mode without a review of their own."""
        return [tuple(item.split(":", 1)) for item in self.all.get("deferred", "").split() if ":" in item]

    def fast_switch(self, value):
        """`fast on|off` between phases: from the next ticket on, level 1 and 2 tickets skip or get their own
        review. Tickets already deferred keep the feature review at the end."""
        return time_budget.fast_switch(self, value)

    def check_code(self, allowed=False, final=False):
        """Stop when the files the conductor runs from changed since the ticket was picked."""
        whole, each = self.flow_code()
        if whole == self.get("code_sha"):
            return
        if allowed:
            self.snapshot_code()
            return
        names = codehash.changed(codehash.load(self.get("code_files")), each)
        if final:
            raise Stop("flow code changed during the feature review of %s: %s. a reviewer must never change it"
                       % (self.feature, ", ".join(names)))
        raise Stop("flow code changed while building %s: %s. if intended, the ticket needs a line: "
                   "Floor: allow flow-edit" % (self.ticket_name(), ", ".join(names)))

    # ---- commands ------------------------------------------------------

    def handoff(self):
        """Release the owner; the user continues in a new session with the printed line."""
        return guards.handoff(self)

    def check_owner(self):
        """While a session owns the feature, every call must carry its token. Checked before any change."""
        guards.check_owner(self)

    # ---- the time budget: fast mode when over, then a re-plan the user says yes to --

    def num_all(self, key):
        return self.all.num(key)

    def budget_cmd(self, value=None):
        """`budget` reports; `budget <minutes>|+<minutes>|off` sets it between phases."""
        return time_budget.budget_cmd(self, value)

    def replan_prompt(self, mode=None):
        """The feature-planner's prompt to fold the open tickets into fewer (between tickets), or to repair the plan."""
        return guards.replan_prompt(self, mode)

    def start(self):
        if not self.plan.is_dir():
            return self.emit("PLAN")
        takeover, wanted, driver = guards.before_start(self)
        token = secrets.token_hex(8)
        if driver:
            self.all["driver"] = driver
        self.all["owner"] = owner_hash(token)
        self.all["session_done"] = 0
        self.all["lanes"] = wanted if wanted > 1 else ""
        fast = os.environ.get("FLOW_FAST", "")
        mode_ok("fast", fast=fast)
        if fast:
            self.all["fast"] = "1" if fast == "1" else ""
        budget = os.environ.get("FLOW_BUDGET", "")
        if budget:
            time_budget.set_budget(self, budget)
        self.all["seen"] = int(time.time())  # the time between sessions is not spent on the feature
        self.save()
        self.log("TAKEOVER" if takeover else "START")
        self.log("DRIVER-%s" % self.driver().upper())
        if self.profile:
            self.log("PROFILE-%s" % self.profile.upper())
        return "OK %s" % token

    def next(self, lane=None):
        self.check_owner()
        time_budget.tick(self)
        wide = self.run_wide("next", lane)
        if wide is not None:
            if not self.plan.is_dir():
                raise Stop("no plan folder %s" % self.plan)
            line = guards.after_phase(self)
            if line is not None:
                return line
            run_reset.counters(self)  # a reset that kept the tester's phase has none
            return wide.judge(self).line
        if self.scheduler().lanes:
            return self.scheduler().next(lane)
        if lane is not None:
            raise Stop("next %s: this run has no lanes (start it with FLOW_LANES=2 or more for lanes)" % lane)
        self.scheduler().put_back()
        if not self.plan.is_dir():
            raise Stop("no plan folder %s" % self.plan)
        line = guards.after_phase(self) or guards.after_repair(self)
        if line is not None:
            return line
        if "limit" not in self.all:
            self.all["limit"] = self.run_limit()
            self.all.setdefault("runs", 0)
            self.all.setdefault("done", 0)
        phase = REGISTRY.get(self.get("phase"))
        if phase is not None:
            return phase.judge(self).line
        return self.scheduler().next(lane)

    def scheduler(self):
        """The scheduler of this call, picked once: lanes, else one ticket at a time (a batch when it may be)."""
        if self.sched is None:
            self.sched = LaneScheduler(self) if self.num_all("lanes") > 1 else BatchScheduler(self)
        return self.sched

    def run_wide(self, command, lane):
        """The class of the run-wide phase (the tester, the feature review) pending, else None. It has no lane."""
        phase = REGISTRY.get(self.all.get("phase"))
        if phase is None or phase.lane_scoped:
            return None
        if lane is not None:
            raise Stop("%s %s: the %s has no lane. run %s without one" % (command, lane, phase.who, command))
        return phase

    def reset(self, num=None):
        """Put the feature back to a clean start: reopen a half-built ticket (or ticket num), commit that,
        and forget the run. The tickets stay the truth; only the conductor's note and counters go."""
        return run_reset.reset(self, num)

    def prompt(self, lane=None, to_file=False):
        """The full prompt for the BUILD or REVIEW that `next` handed out (NoPhase when none is). to_file: in files,
        a `PROMPT-FILE <path> <sha256>` line each, so the session hands a subagent a path, not 20 KB of text."""
        self.check_owner()
        wide = self.run_wide("prompt", lane)
        with self.pending_phase("prompt", lane) as ws:
            text = wide.prompt(self) if wide is not None else ws.prompt_text()
        return prompt_files(self.state_file, self.feature, lane, text) if to_file else text

    def consult_prompt(self, role, question_file):
        """A consultant's prompt for a question the planner raised. Stateless, like the other plan commands."""
        return Planner(self).consult_prompt(role, question_file)

    def brainstorm_prompt(self, helper, question_file):
        """A brainstorm helper's prompt. The script counts the helpers per brainstorm and refuses past the limit."""
        return Planner(self).brainstorm_prompt(helper, question_file)

    # ---- scouts: cheap read only helpers the session spawns before a role starts --

    def pending_phase(self, command, lane):
        """A context with the Workspace of the pending phase: the run's (the feature review's too), or the lane's."""
        if self.run_wide(command, lane) is not None:
            return contextlib.nullcontext(self)
        if self.scheduler().lanes or lane is not None:
            sched = self.lane_sched()
            return sched.workspace(sched.lane_number(lane, command)).entered()
        return contextlib.nullcontext(self)

    def scouts(self, lane=None):
        """`SCOUT <k> <agent> <reply file>` lines for the phase handed out last, or NONE. Clears old replies."""
        self.check_owner()
        with self.pending_phase("scouts", lane) as ws:
            return ws.list_scouts()

    def scout_prompt(self, k, lane=None):
        """The whole prompt of scout k for the phase handed out last."""
        self.check_owner()
        with self.pending_phase("scout-prompt", lane) as ws:
            if ws.get("scout_key") != ws.phase_key():
                raise NoPhase("run scouts first: no scouts are listed for the phase pending for %s" % self.feature)
            return one_scout(self, ws.scout_questions(), k, str(ws.folder.resolve()) if ws.lane else None, ws.prompts_top)

    def plan_scouts(self, brief):
        """The scouts before planning: saves the brief and lists `SCOUT` lines as `scouts` does."""
        return Planner(self).plan_scouts(brief)

    def plan_scout_prompt(self, k):
        return Planner(self).plan_scout_prompt(k)

    def verdict(self, reply, lane=None):
        """Record the reviewer's reply. Exit 2 (NoPhase) unless a review is pending."""
        self.check_owner()
        reply = Path(reply).resolve()
        wide = REGISTRY.get(self.all.get("phase"))
        if wide is not None and not wide.lane_scoped:
            if wide.takes_verdict:
                if lane is not None:
                    raise Stop("verdict for lane %s: the %s has no lane. run verdict without one" % (lane, wide.who))
                self.all["findings_for"] = ""
            return wide.record(self, reply)
        if self.scheduler().lanes or lane is not None:
            sched = self.lane_sched()
            k = sched.lane_number(lane, "verdict")
            with sched.workspace(k).entered() as ws:
                line = ws.pending().record(ws, reply)
            self.all["findings_for"] = str(k)
            self.save()
            return line
        return self.pending().record(self, reply)

    # ---- lanes: tickets side by side in their own worktrees ---------------

    def lane_sched(self):
        """The lane scheduler: this call's in a lane run, else one for the lane checks, start and reset."""
        sched = self.scheduler()
        return sched if sched.lanes else LaneScheduler(self)

    # ---- planning: stateless, the brief and the draft are all there is --

    def plan_prompt(self, brief, findings=None):
        """The feature-planner's prompt. Saves the brief; a first round (no findings) starts an empty draft."""
        return Planner(self).plan_prompt(brief, findings)

    def plan_review_prompt(self):
        """The plan-reviewer's prompt: the saved brief and the draft, nothing from the planner."""
        return Planner(self).plan_review_prompt()

    def plan_accept(self):
        """Copy a draft that passes the check into the plan folder. Never overwrites, never commits."""
        return Planner(self).plan_accept()
