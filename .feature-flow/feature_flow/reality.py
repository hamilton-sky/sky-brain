"""Plan vs reality: what each ticket planned to change, and what its build changed, from files the run already keeps.

The plan is the ticket as approved: its `Touches:` line and its `Level:`, header lines the floor guard keeps a
builder from editing. The reality is the run's log (.feature-flow/state/flow-<feature>.log): the paths the
footprint check saw changed (`CHANGED [...]`, its last build), the level each review ran at (`LEVEL-<n>`),
the builds, a file outside Touches the builder named (`FOOTPRINT-EXTRA`), a build sent back for leaving Touches
(`FOOTPRINT-FAIL`), the questions the roles decided (`DECISION`, in the plan's decisions.md), the findings left
for later (`FOLLOWUPS <n>`, in followups.md) and the re-plans and repairs. Read-only; nothing here is a source
of truth of its own. `feature-flow report` prints it, and the guided flow's Build tab shows it.
"""

import json
import os
from pathlib import Path

from feature_flow import report, state, tickets


def log_rows(top, feature):
    """The run log's rows for the feature, [] when there is no log yet."""
    text = state.read_text(state.log_path(Path(top) / state.STATE_DIR, feature))
    return report.parse(text) if text else []


def collect(plan_folder, rows):
    """([per ticket dict] in plan order, {"replan": n, "repair": n}) for a plan folder and its log rows."""
    g = tickets.Graph(tickets.ticket_files(Path(plan_folder) / "tasks"))
    seen = {}
    run = {"replan": 0, "repair": 0}
    for num, event, detail in rows:
        if event == "REPLAN":
            run["replan"] += 1
        elif event == "REPAIR":
            run["repair"] += 1
        if num in ("", "-"):
            continue
        row = seen.setdefault(num, {"changed": None, "builds": 0, "levels": set(), "extra": 0, "outside": 0,
                                    "decisions": 0, "followups": 0})
        if event == "CHANGED":
            try:
                row["changed"] = [str(p) for p in json.loads(detail)]
            except ValueError:
                pass
        elif event == "BUILD":
            row["builds"] += 1
        elif event.startswith("LEVEL-") and event[6:].isdigit():
            row["levels"].add(int(event[6:]))
        elif event == "FOOTPRINT-EXTRA":
            row["extra"] += 1
        elif event == "FOOTPRINT-FAIL":
            row["outside"] += 1
        elif event == "DECISION":
            row["decisions"] += 1
        elif event == "FOLLOWUPS":
            row["followups"] += int(detail) if detail.isdigit() else 1
    out = []
    for t in g.order:
        lab = g.lab[t]
        got = seen.get(lab, {})
        touches = g.touches.get(t)
        changed = got.get("changed")
        planned_level = g.level.get(t, "")
        ran = max(got.get("levels") or [0])
        item = {"num": lab, "title": g.title[t], "status": g.stat[t], "touches": touches, "changed": changed,
                "unplanned": [], "untouched": [], "planned_level": planned_level,
                "level": str(ran) if ran else "", "builds": got.get("builds", 0), "extra": got.get("extra", 0),
                "outside": got.get("outside", 0), "decisions": got.get("decisions", 0),
                "followups": got.get("followups", 0)}
        if touches is not None and changed is not None:
            item["unplanned"] = [p for p in changed if not tickets.matches_sensitive(p, touches)]
            item["untouched"] = [p for p in touches if not any(tickets.matches_sensitive(c, [p]) for c in changed)]
        out.append(item)
    return out, run


def notes(item):
    """The ways the ticket's reality differed from its plan, as short phrases; [] when it went as planned."""
    said = []
    if item["unplanned"]:
        said.append("changed outside Touches: %s" % ", ".join(item["unplanned"][:5]))
    if item["outside"]:
        said.append("sent back %d time%s for leaving Touches" % (item["outside"], "" if item["outside"] == 1 else "s"))
    if item["extra"]:
        said.append("one extra file named by the builder")
    if item["untouched"]:
        said.append("planned but not changed: %s" % ", ".join(item["untouched"][:5]))
    if item["level"] and item["planned_level"].isdigit() and int(item["level"]) > int(item["planned_level"]):
        said.append("level raised %s to %s" % (item["planned_level"], item["level"]))
    if item["builds"] > 1:
        said.append("built %d times" % item["builds"])
    if item["decisions"]:
        said.append("%d question%s decided by a role (decisions.md)" % (item["decisions"], "" if item["decisions"] == 1 else "s"))
    if item["followups"]:
        said.append("%d finding%s left for later (followups.md)" % (item["followups"], "" if item["followups"] == 1 else "s"))
    return said


def _paths(paths, none):
    if paths is None:
        return none
    return ", ".join(paths[:6]) + (" and %d more" % (len(paths) - 6) if len(paths) > 6 else "") if paths else "nothing"


def run_line(run):
    if not run["replan"] and not run["repair"]:
        return "The plan was not changed during the run."
    return "The plan changed during the run: re-planned %d time%s, repaired %d time%s." % (
        run["replan"], "" if run["replan"] == 1 else "s", run["repair"], "" if run["repair"] == 1 else "s")


def text(items, run):
    """The report's plan vs reality section."""
    out = ["plan vs reality", ""]
    if not items:
        return "\n".join(out + ["no tickets"]) + "\n"
    for item in items:
        out.append("%s %s (%s)" % (item["num"], item["title"], item["status"]))
        out.append("  planned: %s" % _paths(item["touches"], "no Touches line"))
        out.append("  changed: %s" % _paths(item["changed"], "not built yet"))
        said = notes(item)
        out.append("  " + ("; ".join(said) if said else ("as planned" if item["changed"] is not None else "-")))
    out += ["", run_line(run)]
    return "\n".join(out) + "\n"


def markdown(items, run):
    """The Build tab's plan vs reality table."""
    if not items:
        return ""
    rows = ["| Ticket | Planned | Changed | Differences |", "|---|---|---|---|"]
    for item in items:
        said = notes(item)
        rows.append("| %s %s | %s | %s | %s |" % (
            item["num"], item["title"].replace("|", "/"), _paths(item["touches"], "no Touches line"),
            _paths(item["changed"], "not built yet"),
            "; ".join(said).replace("|", "/") if said else ("as planned" if item["changed"] is not None else "")))
    return ("What each ticket planned to change, next to what its build changed, from the run's log. "
            "Read only: the plan files stay the source of truth.\n\n" + "\n".join(rows) + "\n\n" + run_line(run))


def for_plan(plan_folder, feature, top=None):
    """(items, run) for an accepted plan folder, reading the log under top (the folder's repo by default)."""
    top = top or _top_of(plan_folder)
    return collect(plan_folder, log_rows(top, feature) if top else [])


def _top_of(plan_folder):
    folder = Path(plan_folder).resolve()
    depth = len(Path(os.environ.get("FLOW_DIR", "plans")).parts) + 1
    return folder.parents[depth - 1] if len(folder.parents) >= depth else None
