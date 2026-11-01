"""feature-flow report <feature>: what a run did, read from its log.

usage: feature-flow report <feature>
Reads .feature-flow/state/flow-<feature>.log (one `time,ticket,EVENT` line per step, the time in UTC) and prints, per
ticket, how many times it was built and reviewed and which checks failed, then the run's STOPs, resets
and handoffs. Read-only. It cannot see a trust-runner STOP (the runner stops before the conductor
logs anything): the session's own output shows those, so count them by hand.
"""

import sys
from pathlib import Path

from feature_flow import git, state, suggest

USAGE = "usage: feature-flow report <feature>"
FAILS = ("GATE-FAIL", "GUARD-FAIL", "DONEWHEN-FAIL", "TESTFIRST-FAIL", "VERDICT-FAIL")
RUN_EVENTS = ("START", "TAKEOVER", "RESET", "HANDOFF", "STOP")


def parse(text):
    """[(ticket, event, detail)] for each well formed line; a bad line is skipped."""
    rows = []
    for line in text.splitlines():
        parts = line.split(",", 2)
        if len(parts) != 3 or not parts[2].strip():
            continue
        event, _, detail = parts[2].strip().partition(" ")
        rows.append((parts[1].strip(), event, detail.strip()))
    return rows


def summarize(rows):
    """(per-ticket dict in first-seen order, run-level counts, STOP reasons)."""
    tickets = {}
    run = {name: 0 for name in RUN_EVENTS}
    stops = []
    for num, event, detail in rows:
        if event in RUN_EVENTS:
            run[event] += 1
            if event == "STOP":
                stops.append((num, detail or "(no reason logged)"))
        if num in ("", "-") or event in RUN_EVENTS:
            continue
        row = tickets.setdefault(num, {})
        row[event] = row.get(event, 0) + 1
    return tickets, run, stops


def render(feature, rows):
    tickets, run, stops = summarize(rows)
    unsafe = any(event == "GATE-OFF-UNSAFE" for _, event, _ in rows)
    relaxed = sorted({event[len("FLOOR-RELAXED-"):].lower() for _, event, _ in rows if event.startswith("FLOOR-RELAXED-")})
    out = ["report for %s: %d log line(s)%s%s" % (feature, len(rows), ", gate off (unsafe)" if unsafe else "",
                                                   ", floor relaxed: %s" % ", ".join(relaxed) if relaxed else ""), ""]
    if tickets:
        out.append("ticket  level  builds  reviews  single  quick-gate  full-gate  failures")
        for num, row in tickets.items():
            fails = ", ".join("%s x%d" % (name, row[name]) for name in FAILS if row.get(name))
            level = max([n for n in (1, 2, 3) if row.get("LEVEL-%d" % n)] or [0])
            out.append("%-6s  %5s  %6d  %7d  %6d  %10d  %9d  %s"
                       % (num, level or "-", row.get("BUILD", 0), row.get("REVIEW", 0),
                          row.get("REVIEW-SMALL", 0) + row.get("REVIEW-SINGLE", 0),
                          row.get("GATE-QUICK", 0), row.get("GATE-FULL", 0), fails or "none"))
        reworked = [n for n, row in tickets.items() if row.get("BUILD", 0) > 1]
        followups = [n for n, row in tickets.items() if row.get("PASS-FOLLOWUPS")]
        out += ["", "tickets built more than once (reworked): %s" % (", ".join(reworked) or "none")]
        if followups:
            out.append("tickets passed with follow-ups (see the plan's followups.md): %s" % ", ".join(followups))
    else:
        out.append("no ticket events yet")
    out += ["", "starts %d, takeovers %d, resets %d, handoffs %d, stops %d"
            % (run["START"], run["TAKEOVER"], run["RESET"], run["HANDOFF"], run["STOP"])]
    for num, reason in stops:
        out.append("  STOP at ticket %s: %s" % (num, reason))
    out += ["", "trust-runner STOPs are not in this log: count them from the session by hand"]
    return "\n".join(out) + "\n"


def main(argv, out=None, err=None):
    out = out or sys.stdout
    err = err or sys.stderr
    if len(argv) != 1 or argv[0].startswith("-"):
        err.write(USAGE + "\n")
        return 2
    feature = argv[0]
    top = git.toplevel()
    if top is None:
        err.write("not inside a git repo\n")
        return 2
    path = state.log_path(Path(top) / state.STATE_DIR, feature)
    text = state.read_text(path)
    if text is None:
        err.write("no run log for %s (%s)\n" % (feature, path))
        err.write(suggest.hint(feature, [p.name[5:-4] for p in path.parent.glob("flow-*.log")]))
        return 2
    out.write(render(feature, parse(text)))
    return 0
