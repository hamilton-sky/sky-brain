"""The checks around a ticket. BEFORE_TICKET: what both schedulers run before a ticket starts, in order, the first
that stops or hands off winning (the session handoff, the re-plan check, the budget; then, once start_ticket has
snapshotted the code, the smoke test), with the whole gate once per run at the base before the first ticket. AFTER_PHASE: the relay, a handoff after each phase handed out, checked by
next before it judges anything. Also the owner check every command makes, the handoff, and the re-plan prompt."""

import hashlib
import os
import re
from pathlib import Path

from feature_flow import checks, floorguard, gate, git, prompts, status, tickets
from feature_flow.conductor import budget, planning
from feature_flow.conductor.errors import Stop
from feature_flow.conductor.settings import MAX_LANES, _env_int, mode_ok


OLD_OWNER = re.compile(r"^[0-9a-f]{16}$")  # a raw token, stored by a run started before 0.5.0


def owner_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def check_owner(c):
    """While a session owns the feature, every call must carry its token. Checked before any change."""
    owner = c.get("owner")
    token = os.environ.get("FLOW_SESSION", "")
    if not owner or owner_hash(token) == owner:
        return
    if OLD_OWNER.match(owner) and token == owner:
        c.all["owner"] = owner_hash(token)  # stored as the hash on the next save
        return
    raise Stop("%s is owned by another session (%s). pass its token as FLOW_SESSION, or start this session "
               "with FLOW_TAKEOVER=1 once you are sure the other one is closed" % (c.feature, owner[:8]))


def before_start(c):
    """start's checks before it takes the feature: the owner (FLOW_TAKEOVER), the lanes, the driver. Returns
    (takeover, the FLOW_LANES wanted, FLOW_DRIVER)."""
    owner = c.get("owner")
    takeover = bool(owner)
    if owner and os.environ.get("FLOW_TAKEOVER", "0") != "1":
        raise Stop("%s is owned by session %s. if that session is closed or dead, run start with FLOW_TAKEOVER=1"
                   % (c.feature, owner[:8]))
    busy = c.lane_sched().busy_lanes()
    wanted, auto = lanes_wanted(c, busy)
    mode_ok("lanes_range", lanes=wanted)
    mode_ok("lanes_relay", lanes=wanted, relay=c.relay)
    mode_ok("lanes_top", lanes=wanted, cwd=Path.cwd().resolve(), top=c.top)
    if busy and wanted != c.num("lanes") and not auto:
        raise Stop("lane(s) %s still hold tickets from the last session, which ran with FLOW_LANES=%d. start with "
                   "that, or reset to drop them" % (",".join(map(str, busy)), c.num("lanes")))
    driver = os.environ.get("FLOW_DRIVER", "")
    mode_ok("driver", driver=driver)
    relaxed(c)
    return takeover, wanted, driver


def relaxed(c):
    """Stops on a commands.md Floor: line the floor guard would refuse, and logs what the plan relaxed or turned off,
    so eval and the report can say the bar moved."""
    cats, why, problem = floorguard.plan_allow(c.show_head(c.commands))
    if problem:
        raise Stop("%s. fix the plan (replan-prompt repair), not the build" % problem)
    for cat in cats.split():
        c.log("FLOOR-RELAXED-%s" % cat.upper())
    if not c.gate_on:
        c.log("GATE-OFF-UNSAFE")
    elif c.checkpointing():  # the full gate and the review run at checkpoints, not after each ticket
        c.log("GATE-END" if c.settings.gate_every == 0 else "GATE-BATCH-%d" % c.settings.gate_every)


LANE_CAPS = {"careful": 2}  # the most lanes `Lanes: auto` gives a profile: fast batches instead, the rest up to MAX_LANES


def lanes_wanted(c, busy):
    """(the lanes this run uses, whether they came from `Lanes: auto`). FLOW_LANES wins, then commands.md's `Lanes:`
    line, a number or auto: the plan's width (flow-status.py --width), capped by the profile. Without either, one.
    auto never stops a run: it takes one lane where lanes cannot run (fast, FLOW_RELAY, not at the top of the repo),
    and keeps the lanes a last session left busy."""
    if os.environ.get("FLOW_LANES"):
        return _env_int("FLOW_LANES", 1), False
    value = (tickets.commands_text_value(c.show_head(c.commands), "Lanes") or "").strip().lower()
    if not value:
        return 1, False
    if value != "auto":
        if not value.isdigit():
            raise Stop("commands.md's Lanes: must be auto or 1 to %d, not %s" % (MAX_LANES, value))
        return int(value), False
    if busy:
        return c.num("lanes"), True
    if os.environ.get("FLOW_FAST") == "1" or c.fast() or c.relay or Path.cwd().resolve() != c.top:
        return 1, True
    folder = c.plan / os.environ.get("FLOW_TICKETS", "tasks")
    graph = tickets.Graph(tickets.ticket_files(folder))
    width = status.width_of(graph, str(c.commands))[0]
    wanted = max(1, min(width, LANE_CAPS.get(c.profile, MAX_LANES), MAX_LANES))
    c.log("LANES-AUTO-%d" % wanted)
    return wanted, True


def handoff(c):
    """Release the owner; the user continues in a new session with the printed line."""
    c.all["owner"] = ""
    c.all["relay_handoff"] = ""
    c.save()
    return c.emit("HANDOFF %s %s" % (c.invoke, c.feature))


def replan_prompt(c, mode=None):
    """The feature-planner's prompt to fold the open tickets into fewer, only between tickets; or with mode `repair`,
    to repair the plan around the ticket in progress (its Touches, a missing ticket, commands.md), which `next`
    then builds again from the repaired plan."""
    c.check_owner()
    if not c.plan.is_dir():
        raise Stop("no plan folder %s" % c.plan)
    if mode not in (None, "repair"):
        raise Stop("replan-prompt takes nothing, or repair, not %s" % mode)
    if c.lane_sched().busy_lanes():
        raise Stop("lanes hold tickets. run replan-prompt once no lane is busy")
    if mode == "repair":
        if c.all.get("phase") not in ("", "build", "ask"):
            raise Stop("a %s is pending. run replan-prompt repair when next stops on a ticket, or between tickets"
                       % c.all.get("phase"))
        c.all["repair_sha"] = git.head()
        c.all["repair_num"] = c.get("num") if c.all.get("phase") else ""
        c.save()
        c.log("REPAIR-PROMPT")
        try:
            return prompts.replan(c.scripts, c.feature, c.plan.as_posix(), [], (c.plan / planning.BRAINSTORM).is_file(),
                                  repair=c.ticket() if c.all.get("phase") else "")
        except FileNotFoundError as err:
            raise Stop(str(err))
    if c.all.get("phase"):
        raise Stop("a ticket is in progress. run replan-prompt between tickets, when next would start a new one, "
                   "or replan-prompt repair to repair the plan around it")
    folder = c.plan / (os.environ.get("FLOW_TICKETS") or "tasks")
    paths = tickets.ticket_files(str(folder))
    open_ones = [p for p in paths if tickets.status(p) not in tickets.DONE + ("parked", "wontfix")]
    if len(open_ones) < 2:
        raise Stop("%d open ticket(s) left, nothing to fold together" % len(open_ones))
    c.all["replan_sha"] = git.head()
    c.save()
    c.log("REPLAN-PROMPT")
    try:
        return prompts.replan(c.scripts, c.feature, c.plan.as_posix(),
                              [Path(p).as_posix() for p in open_ones], (c.plan / planning.BRAINSTORM).is_file())
    except FileNotFoundError as err:
        raise Stop(str(err))


def check_replan(c, key="replan_sha"):
    """After a re-plan was handed out: the resolved tickets must be as they were, and the plan committed."""
    sha = c.all.get(key)
    if not sha:
        return
    folder = (c.plan / (os.environ.get("FLOW_TICKETS") or "tasks")).as_posix()
    changed = git._git("diff", "--name-only", sha, "HEAD", "--", folder, check=False).stdout.split()
    for path in changed:
        try:
            before = git.show_text("%s:%s" % (sha, path))
        except RuntimeError:
            continue  # a new ticket
        if re.search(r"^Status:[ \t]*(resolved|done|closed)\b", before, re.MULTILINE | re.IGNORECASE):
            raise Stop("the re-plan changed %s, which was resolved before it. put it back with `git checkout %s "
                       "-- %s` and commit" % (path, sha[:12], path))
    c.all[key] = ""
    if changed:
        c.log("REPLAN")


def after_repair(c):
    """After `replan-prompt repair`: once the repaired plan is committed, the ticket that stopped is started again
    from it (its base moves to HEAD, so its new Touches and Done when count) and handed out. None: nothing to do."""
    sha, num = c.all.get("repair_sha"), c.all.get("repair_num")
    if not sha or git.head() == sha:
        return None
    if num and c.get("num") == num and c.all.get("phase") in ("build", "ask"):
        code = git.diff_names(c.get("base"), git.head(), c.plan.as_posix())
        if code:
            raise Stop("%s has code commits (%s), which no review would see once its base "
                       "moves. run reset %s, then next" % (c.ticket_name(), ", ".join(code[:5]), num))
    check_replan(c, "repair_sha")
    c.all["repair_num"] = ""
    c.log("REPAIR")
    if not num or c.get("num") != num or c.all.get("phase") not in ("build", "ask"):
        c.save()
        return None
    from feature_flow.conductor.phases.build import Build  # the phases import the guards
    tickets.set_open(c.ticket())
    git.commit_file(c.ticket(), "chore(%s): %s open again after the plan repair" % (c.feature, num))
    c.scheduler().start_ticket(c.ticket())
    return Build.hand_out(c)


def smoke_command(c):
    cmd = os.environ.get("FLOW_SMOKE", "")
    if not cmd:
        cmd = tickets.commands_value(c.at(c.commands), "Smoke")
    return "" if cmd.startswith("<") else cmd


def run_smoke(c):
    cmd = smoke_command(c)
    if not cmd:
        return
    result = checks.smoke(cmd, c.gate_timeout, cwd=c.folder)
    if not result.ok:
        log = c.state_file.with_name("%s.smoke.log" % c.feature)
        text = result.out
        if result.timed_out:
            text += "\nsmoke test timed out after %d minutes\n" % c.gate_timeout
        log.write_text(gate.tail(text), encoding="utf-8")
        raise Stop("smoke test %s before %s: the base is already broken. fix it first. command: %s. "
                   "the last %d lines are in %s"
                   % ("timed out after %d minutes" % c.gate_timeout if result.timed_out else "failed",
                      c.ticket_name(), cmd, gate.TAIL, log))


class Guard:
    """run(c, busy) is None to go on, or the line to print instead of starting a ticket; a Stop stops the run.
    busy lists the lanes that hold a ticket (always empty one ticket at a time). stage says when it runs: "pick"
    before the scheduler picks the ticket, "start" once start_ticket has set the ticket up."""

    name = ""
    stage = "pick"

    def run(self, c, busy):
        raise NotImplementedError


class SessionHandoff(Guard):
    """FLOW_TICKETS_PER_SESSION reached (busy lanes count): hand off, or with lanes still busy, wait for them."""

    name = "session"

    def run(self, c, busy):
        if c.per_session > 0 and c.num("session_done") + len(busy) >= c.per_session:
            return c.emit("WAIT %s" % ",".join(map(str, busy))) if busy else c.handoff()
        return None


class Replan(Guard):
    """The re-plan check, only with no lane busy."""

    name = "replan"

    def run(self, c, busy):
        if not busy:
            check_replan(c)
        return None


class Budget(Guard):
    """The time budget; its re-plan offer only with no lane busy, as a stop while lanes work would strand them."""

    name = "budget"

    def run(self, c, busy):
        budget.check_budget(c, offer=not busy)
        return None


class BaseGate(Guard):
    """The whole gate once per run, at the base, before the first ticket: a red Lint or Test there would fail
    the first ticket's gate for something no builder may touch. Only with FLOW_BASE_GATE on (the standard and
    careful profiles), the gate on and no lane busy."""

    name = "base"

    def run(self, c, busy):
        if busy or not c.settings.base_gate or not c.gate_on or c.all.get("base_gate"):
            return None
        result = checks.gate(c.scripts, c.feature, c.gate_timeout)
        c.log("BASE-GATE-PASS" if result.ok else "BASE-GATE-FAIL")
        if not result.ok:
            log = c.state_file.with_name("%s.base-gate.log" % c.feature)
            log.write_text(gate.tail(result.out), encoding="utf-8")
            raise Stop("the gate fails before any ticket of %s is built: the base is already red, and no builder may "
                       "fix what it names. fix it first (or re-plan with a ticket that fixes it), commit, and run next. "
                       "the last %d lines are in %s: %s"
                       % (c.feature, gate.TAIL, log, " ".join(gate.tail(result.out, 6).split())[:400]))
        c.all["base_gate"] = git.head()
        c.save()
        return None


class Smoke(Guard):
    """The smoke test, after the code snapshot of start_ticket."""

    name = "smoke"
    stage = "start"

    def run(self, c, busy):
        run_smoke(c)
        return None


BEFORE_TICKET = (SessionHandoff(), Replan(), Budget(), BaseGate(), Smoke())


def before_ticket(c, busy=(), stage="pick", only=None):
    """Run the guards of stage (those named in only, when given) in BEFORE_TICKET's order: the first line one
    returns, else None."""
    busy = list(busy)
    for guard in BEFORE_TICKET:
        if guard.stage != stage or (only is not None and guard.name not in only):
            continue
        line = guard.run(c, busy)
        if line is not None:
            return line
    return None


def mark_relay(c, view):
    """A phase is handed out: with FLOW_RELAY=1, the next call hands off before it judges it."""
    view["relay_handoff"] = "1" if c.relay else ""


class Relay:
    """FLOW_RELAY=1: a handoff after each phase handed out."""

    name = "relay"

    def run(self, c):
        return c.handoff() if c.get("relay_handoff") == "1" else None


AFTER_PHASE = (Relay(),)


def after_phase(c):
    """Before next judges the phase handed out: the first line an AFTER_PHASE guard returns, else None."""
    for guard in AFTER_PHASE:
        line = guard.run(c)
        if line is not None:
            return line
    return None
