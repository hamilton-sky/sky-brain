"""`reset`: put the feature back to a clean start. The tickets stay the truth; only the conductor's note and
counters go."""

import os

from feature_flow import git, state, suggest, tickets
from feature_flow.conductor.errors import Stop
from feature_flow.conductor.store import RunState
from feature_flow.conductor.workspace import Workspace


def reset(c, num=None):
    """Reopen a half-built ticket (or ticket num), commit that, and forget the run."""
    if not c.plan.is_dir():
        hint = suggest.hint(c.feature, suggest.features(c.root)).strip()
        raise Stop("no plan folder %s%s" % (c.plan, ". " + hint if hint else ""))
    owner = c.get("owner")
    if owner and os.environ.get("FLOW_TAKEOVER", "0") != "1":
        raise Stop("%s is owned by session %s. if that session is closed or dead, run reset with FLOW_TAKEOVER=1"
                   % (c.feature, owner[:8]))
    paths = tickets.ticket_files(str(c.plan / (os.environ.get("FLOW_TICKETS") or "tasks")))
    if num is not None:
        chosen = [p for p in paths if tickets.number(p) == num.zfill(2)]
        if not chosen:
            raise Stop("no ticket %s in %s" % (num, c.plan))
    else:
        chosen = [p for p in paths if tickets.status(p) in tickets.RESET]
    reopened = []
    for path in chosen:
        if tickets.status(path) != "open":
            tickets.set_open(path)
            reopened.append(path)
    if reopened:
        nums = ", ".join(tickets.number(p) for p in reopened)
        if not git.commit_paths(reopened, "chore(%s): reset %s to open" % (c.feature, nums)):
            raise Stop("reopened %s but could not commit it. this session must be allowed to run git commit"
                       % nums)
    dropped = c.lane_sched().drop_lanes()
    had_run = c.state_file.is_file()
    keys = ("deferred", "reviewed", "fast", "accept_round", "accept_num", "accept_rulings") + (("budget", "spent", "budget_offer") if c.all.get("budget") else ())
    kept = {k: c.all[k] for k in keys if c.all.get(k)}  # a deferred ticket still owes its review,
    # and a budget's time stays spent
    if c.all.get("phase") == "test" and c.all.get("test_base"):  # the tester's tests are judged after the reset
        kept.update({k: c.all[k] for k in ("phase", "num", "test_base", "test_mode", "test_note") if c.all.get(k)})
    for path, kind in ((c.state_file, "state"), (c.findings_file, "findings")):
        state.remove(path, kind)
    for pattern in ("ask-%s.*" % c.feature, "ask-%s-L*" % c.feature, "scout-%s-*" % c.feature,
                    "edit-%s-*" % c.feature, "prompt-%s-*" % c.feature):
        for path in c.state_file.parent.glob(pattern):
            path.unlink()
    if not reopened and not had_run and not dropped:
        return "OK nothing to reset for %s. run %s %s" % (c.feature, c.invoke, c.feature)
    c.all = RunState(c.state_file, kept)
    Workspace.__init__(c, c)
    if kept.get("phase") == "test":
        c.snapshot_code()  # the code as it is now, an upgrade included, is what the judging holds the tester to
    if kept:
        c.save()
    c.log("RESET")
    done = ["cleared the run state"] if had_run else []
    if kept.get("deferred"):
        done.append("kept %d ticket(s) built in fast mode for the feature review" % len(c.deferred()))
    if kept.get("phase") == "test":
        done.append("kept the tester's commits since %s for the conductor to judge" % kept["test_base"][:12])
    done += dropped
    done += ["reopened %s" % tickets.name(p) for p in reopened]
    return "OK %s. run %s %s" % (", ".join(done), c.invoke, c.feature)


def counters(c):
    """The run's phase limit and counters, when a reset left none: the tester it kept is judged first."""
    if "limit" not in c.all:
        c.all["limit"] = c.run_limit()
        c.all.setdefault("runs", 0)
        c.all.setdefault("done", 0)
