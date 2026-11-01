"""The time budget: fast mode when over, then a re-plan the user says yes to. Each function takes the conductor."""

import time

from feature_flow import checks
from feature_flow.conductor.errors import Stop

GAP = 3600  # most seconds one step adds to the time spent: a longer pause is the user away, not work


def set_budget(c, value):
    """FLOW_BUDGET or `budget <value>`: minutes of work (a number, or +N to add), or off."""
    if value in ("off", "0"):
        c.all["budget"] = ""
        return
    add = value.startswith("+")
    try:
        minutes = int(value[1:] if add else value)
    except ValueError:
        minutes = 0
    if minutes <= 0:
        raise Stop("the budget is a number of minutes, +minutes or off, not %s" % value)
    c.all["budget"] = (c.num_all("budget") if add else 0) + minutes
    c.all["budget_offer"] = ""  # a new budget earns a new offer once it runs out


def tick(c):
    """Add the time since the last step to the time spent, up to GAP for one step."""
    now = int(time.time())
    seen = c.num_all("seen")
    if seen:
        c.all["spent"] = c.num_all("spent") + min(max(now - seen, 0), GAP)
    c.all["seen"] = now


def spent_minutes(c):
    return c.num_all("spent") // 60


def note_slowest(c):
    """Remember the ticket that took longest, to tell a stuck ticket from a slow plan."""
    took = c.num_all("spent") - c.num("ticket_clock")
    slowest = c.all.get("slowest", "").split(":")
    if len(slowest) != 3 or took > int(slowest[1] or 0):
        builds = max(c.num("attempt"), 1) + c.num("round")  # a review round starts the attempts again
        c.all["slowest"] = "%s:%d:%d" % (c.get("num"), took, builds)


def budget_report(c):
    budget = c.num_all("budget")
    if not budget:
        return "OK no budget. %d active minute(s) spent so far" % spent_minutes(c)
    return "OK budget %d minute(s), %d spent, fast %s%s" % (
        budget, spent_minutes(c), "on" if c.fast() else "off",
        " (switched on by the budget at minute %s)" % c.all["budget_fast"] if c.all.get("budget_fast") else "")


def budget_cmd(c, value=None):
    """`budget` reports; `budget <minutes>|+<minutes>|off` sets it between phases."""
    if value is None:
        return budget_report(c)
    c.check_owner()
    tick(c)
    set_budget(c, value)
    c.save()
    c.log("BUDGET-%s" % value.upper())
    return budget_report(c)


def fast_switch(c, value):
    """`fast on|off` between phases: from the next ticket on, level 1 and 2 tickets skip or get their own
    review. Tickets already deferred keep the feature review at the end."""
    c.check_owner()
    if value not in ("on", "off"):
        raise Stop("fast takes on or off, not %s" % value)
    if value == "on" and c.fast():
        return ("OK fast is already on. to go faster still, the open tickets can be re-planned into fewer with the "
                "same bar: with the user's yes, run replan-prompt and give it to the feature-planner")
    c.all["fast"] = "1" if value == "on" else ""
    c.save()
    c.log("FAST-%s" % value.upper())
    return "OK fast %s%s" % (value, "" if value == "on" or not c.deferred() else
                             ". %d ticket(s) already deferred still get the feature review at the end"
                             % len(c.deferred()))


def check_budget(c, offer=True):
    """Before a ticket starts: over the budget, switch to fast mode first. Still over once fast mode has had
    a ticket, stop once and offer a re-plan, which only the user can say yes to. Nothing is cut silently."""
    budget = c.num_all("budget")
    if not budget or c.num_all("spent") < budget * 60:
        return
    if not c.fast():
        c.all["fast"] = "1"
        c.all["budget_fast"] = spent_minutes(c)
        c.all["fast_done"] = c.num_all("done")
        c.save()
        c.log("BUDGET-FAST")
        return
    if c.all.get("budget_offer") or not offer:
        return
    if c.all.get("budget_fast") and c.num_all("done") <= c.num_all("fast_done"):
        return  # fast mode has not finished a ticket yet
    c.all["budget_offer"] = "1"
    c.save()
    c.log("BUDGET-OVER")
    check = checks.flow_status(c.scripts, c.feature, "--counts")
    counts = dict(part.split("=", 1) for part in check.out.split() if "=" in part)
    left = int(counts.get("open", 0) or 0) + int(counts.get("claimed", 0) or 0)
    note = ""
    slowest = c.all.get("slowest", "").split(":")
    if len(slowest) == 3 and int(slowest[1]) * 2 > c.num_all("spent") and int(slowest[2]) > 1:
        note = ("Most of it went to ticket %s (%d minute(s), %s attempts): that ticket is stuck, not the plan, so "
                "look at it first. " % (slowest[0], int(slowest[1]) // 60, slowest[2]))
    raise Stop("over the time budget for %s: %d of %d active minute(s) spent, %d ticket(s) left, fast mode on. %s"
               "To finish sooner, the open tickets can be re-planned into fewer with the same bar: with the user's "
               "yes, run replan-prompt and give it to the feature-planner. To go on as planned, run next, and "
               "`budget <minutes>` sets a new budget" % (c.feature, spent_minutes(c), budget, left, note))
