"""feature-flow eval <feature>: record what a run cost and what it caught, for a field run.

usage: feature-flow eval <feature> [--later] [--out DIR] [--claude-home DIR]
Reads the run log and state in .feature-flow/state/, the plan's tickets, and, when it finds them, the
Claude Code session transcripts of this repo (for tokens). Writes <out>/eval.json, and the first time
<out>/eval-verdict.md, a short form you fill in: was the plan right, what did you fix by hand, and was
each catch real or a false alarm. Run it again after filling the form and eval.json carries your answers.
When the agents asked codeintel (feature_flow/codeintel.py), the record counts their queries and what they said
of each answer, and the form asks whether it helped.
--later also looks at the commits made after the run for fixes and reverts on the files each ticket
touched: run it a week or two after the feature is done. <out> is plans/<feature>/ unless --out is given,
so the record is committed with the plan and survives a cloud session. Nothing is sent anywhere.
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from feature_flow import __version__, brainstorm_mode, codeintel, git, lanes, report, state, suggest, tickets

USAGE = "usage: feature-flow eval <feature> [--later] [--out DIR] [--claude-home DIR] [--compare <eval.json> ...]"
CATCHES = report.FAILS + ("FOOTPRINT-FAIL", "FEATURE-FAIL", "ACCEPT-FAIL")
VERDICT_FILE = "eval-verdict.md"
PLAN_ANSWERS = ("right", "partly", "wrong")
FIX_WORDS = re.compile(r"\b(fix(es|ed)?|revert(s|ed)?|bug|hotfix|regression)\b", re.I)


# ---- the log ---------------------------------------------------------------

def parse_time(text):
    """A log time as a UTC datetime, or None: logs before 0.15.0 hold only HH:MM:SS, with no date."""
    try:
        return datetime.strptime(text.strip(), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def timed(text):
    """[(datetime or None, ticket, event, detail)] for each well formed log line."""
    rows = []
    for line in text.splitlines():
        parts = line.split(",", 2)
        if len(parts) != 3 or not parts[2].strip():
            continue
        event, _, detail = parts[2].strip().partition(" ")
        rows.append((parse_time(parts[0]), parts[1].strip(), event, detail.strip()))
    return rows


def catch_ids(rows):
    """['03 GUARD-FAIL 1', ...]: each failed check, numbered per ticket and check, in log order."""
    seen, ids = {}, []
    for _, num, event, _ in rows:
        if event in CATCHES:
            key = (num, event)
            seen[key] = seen.get(key, 0) + 1
            ids.append("%s %s %d" % (num, event, seen[key]))
    return ids


def rebuilds_by_lane(rows):
    """{lane: rebuilds after a merge conflict} for a run with lanes: a LEASE-k gives the ticket's lane."""
    lane_of, out = {}, {}
    for _, num, event, _ in rows:
        if event.startswith("LEASE-"):
            lane_of[num] = event[len("LEASE-"):]
        elif event == "REBUILD" and num in lane_of:
            out[lane_of[num]] = out.get(lane_of[num], 0) + 1
    return out


def run_summary(rows):
    plain = [(num, event, detail) for _, num, event, detail in rows]
    per, run, stops = report.summarize(plain)
    out = {}
    for num, row in per.items():
        out[num] = {
            "level": max([n for n in (1, 2, 3) if row.get("LEVEL-%d" % n)] or [0]) or None,
            "builds": row.get("BUILD", 0),
            "reviews": row.get("REVIEW", 0),
            "deferred_review": bool(row.get("REVIEW-DEFERRED")),
            "questions": row.get("ASK", 0),
            "catches": {name: row[name] for name in CATCHES if row.get(name)},
        }
    by_check = {}
    for row in out.values():
        for name, count in row["catches"].items():
            by_check[name] = by_check.get(name, 0) + count
    user_questions = sum(1 for _, _, event, _ in rows if event.startswith("ASK-") and event.endswith("-USER"))
    times = [t for t, _, _, _ in rows if t is not None]
    return out, {
        "tickets": len(out),
        "builds": sum(r["builds"] for r in out.values()),
        "reviews": sum(r["reviews"] for r in out.values()),
        "reworked": sorted(n for n, r in out.items() if r["builds"] > 1),
        "catches": sum(by_check.values()),
        "catches_by_check": by_check,
        "lanes": any(event.startswith("LEASE-") for _, _, event, _ in rows),
        "deferred_checks": sum(int(detail or 1) for _, _, event, detail in rows if event == "DONEWHEN-DEFERRED"
                               and (detail or "1").isdigit()),
        "fast": any(event in ("REVIEW-DEFERRED", "BUDGET-FAST") for _, _, event, _ in rows),
        "gate_off": any(event == "GATE-OFF-UNSAFE" for _, _, event, _ in rows),
        "floor_relaxed": sorted({event[len("FLOOR-RELAXED-"):].lower() for _, _, event, _ in rows
                                 if event.startswith("FLOOR-RELAXED-")}),
        "rebuilds_by_lane": rebuilds_by_lane(rows),
    }, {
        "stops": [{"ticket": n, "reason": r} for n, r in stops],
        "handoffs": run["HANDOFF"],
        "resets": run["RESET"],
        "takeovers": run["TAKEOVER"],
        "questions_to_user": user_questions,
        "guided_stops": [event[len("GUIDED-"):].lower() for _, _, event, _ in rows if event.startswith("GUIDED-")],
    }, (min(times), max(times)) if times else None


PHASE_OF = {"BUILD": "build", "CHECKS": "checks", "REVIEW": "review", "ASK": "ask", "TEST": "test",
            "STOP": "waiting", "HANDOFF": "waiting", "RESET": "waiting", "DONE": "waiting"}


def timing(rows, per):
    """Where the run's wall clock went, from the log's timestamps, which survive a reset: minutes per phase (build,
    checks, review, ask, test, waiting for the user), per ticket and per level, the slowest ticket and its biggest
    phase, how often the gate ran the whole Test command per ticket, and the gate's minutes per command (from its
    GATE-TIME lines). None for a log without dates."""
    stamped = [r for r in rows if r[0] is not None]
    if len(stamped) < 2:
        return None
    by_kind, by_ticket, kind, num = {}, {}, "waiting", "-"
    for (t, n, event, _), (t2, _, _, _) in zip(stamped, stamped[1:]):
        if event in PHASE_OF:
            kind = PHASE_OF[event]
            num = n if kind in ("build", "checks", "review", "ask") else "-"
        elif event in ("START", "TAKEOVER"):
            kind, num = "waiting", "-"
        minutes = (t2 - t).total_seconds() / 60
        by_kind[kind] = by_kind.get(kind, 0) + minutes
        if num != "-" and num in per:
            row = by_ticket.setdefault(num, {})
            row[kind] = row.get(kind, 0) + minutes
    by_level = {}
    for n, row in by_ticket.items():
        level = str(per[n].get("level") or "none")
        by_level[level] = by_level.get(level, 0) + sum(row.values())
    full = {}
    for _, n, event, _ in rows:
        if event in ("GATE-FULL", "MERGE-GATE-FULL-PASS", "MERGE-GATE-FULL-FAIL"):
            full[n] = full.get(n, 0) + 1
    gate_seconds = {}
    for _, _, event, detail in rows:
        if event == "GATE-TIME":
            for part in detail.split():
                name, _, value = part.partition("=")
                if value.isdigit():
                    gate_seconds[name] = gate_seconds.get(name, 0) + int(value)
    slowest = None
    if by_ticket:
        n = max(by_ticket, key=lambda k: sum(by_ticket[k].values()))
        slowest = {"ticket": n, "minutes": round(sum(by_ticket[n].values())),
                   "most_in": max(by_ticket[n], key=by_ticket[n].get)}
    whole = (stamped[-1][0] - stamped[0][0]).total_seconds() / 60
    return {"wall_minutes": round(whole), "by_phase": {k: round(v) for k, v in sorted(by_kind.items())},
            "by_ticket": {n: {k: round(v) for k, v in sorted(row.items())} for n, row in sorted(by_ticket.items())},
            "by_level": {k: round(v) for k, v in sorted(by_level.items())}, "slowest": slowest,
            "full_test_runs": dict(sorted(full.items())),
            "gate_minutes": {k: round(v / 60.0, 1) for k, v in sorted(gate_seconds.items())}}


def driver(rows, run_state):
    """Who drove the run: "agent" or "person", from the log's DRIVER- lines (the last start wins), else the state."""
    found = [event[len("DRIVER-"):].lower() for _, _, event, _ in rows if event.startswith("DRIVER-")]
    return found[-1] if found else (run_state.get("driver") or "person")


def settled_at_plan(plan_dir, built):
    """The tickets resolved without ever being built in a run: settled when the plan was approved."""
    found = []
    for path in tickets.ticket_files(str(plan_dir / (os.environ.get("FLOW_TICKETS") or "tasks"))):
        num = tickets.number(path)
        if num not in built and tickets.status(path) in tickets.DONE + ("wontfix",):
            found.append(num)
    return found


def followups(plan_dir):
    """The items in the plan's followups.md: its `- ` lines."""
    text = state.read_text(plan_dir / "followups.md") or ""
    return sum(1 for line in text.splitlines() if line.startswith("- "))


# ---- tokens, from Claude Code's session transcripts ------------------------------

def claude_home(explicit=None):
    if explicit:
        return Path(explicit)
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")


def _inside(cwd, top):
    try:
        Path(cwd).resolve().relative_to(top)
        return True
    except (ValueError, OSError):
        return False


def records(home, top, window):
    """(file, record) for each transcript record written in this repo during the run, from Claude Code's session
    transcripts (and their subagents'). Nothing when there is no window or no transcripts."""
    projects = Path(home) / "projects"
    if window is None or not projects.is_dir():
        return
    start, end = window
    since = start.timestamp() - 60
    top = Path(top).resolve()
    for path in projects.rglob("*.jsonl"):
        try:
            if path.stat().st_mtime < since:
                continue
            handle = open(path, encoding="utf-8", errors="replace")
        except OSError:
            continue
        with handle:
            for line in handle:
                if '"message"' not in line:
                    continue
                try:
                    item = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(item, dict) or not isinstance(item.get("message"), dict):
                    continue
                if not _inside(item.get("cwd") or "", top):
                    continue
                when = parse_iso(item.get("timestamp"))
                if when is None or when < start or when > end:
                    continue
                yield path, item


def tokens(found, rows):
    """Token use of the transcript records found, summed from their usage records, each message counted once.
    Split per ticket by time slice: a record goes to the ticket of the last log line before it (approximate; with
    lanes the slices overlap, so no split is given). None when there is nothing to read."""
    marks = sorted((t, num) for t, num, _, _ in rows if t is not None)
    seen, total, models, per, files = set(), {}, {}, {}, set()
    for path, item in found:
        message = item["message"]
        usage = message.get("usage")
        if not isinstance(usage, dict):
            continue
        key = (message.get("id"), item.get("requestId"))
        if key != (None, None):
            if key in seen:
                continue
            seen.add(key)
        files.add(path)
        counts = {
            "input": int(usage.get("input_tokens") or 0),
            "output": int(usage.get("output_tokens") or 0),
            "cache_read": int(usage.get("cache_read_input_tokens") or 0),
            "cache_write": int(usage.get("cache_creation_input_tokens") or 0),
        }
        add(total, counts)
        add(models.setdefault(message.get("model") or "unknown", {}), counts)
        when = parse_iso(item.get("timestamp"))
        num = "-"
        for t, n in marks:
            if t > when:
                break
            num = n
        add(per.setdefault(num, {}), counts)
    if not total:
        return None
    return {"source": "claude-code transcripts", "files": len(files), "total": total, "by_model": models,
            "by_ticket": per, "by_ticket_note": "approximate: split by the time between log lines"}


def parse_iso(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def add(into, counts):
    for key, value in counts.items():
        into[key] = into.get(key, 0) + value


# ---- the human verdict ---------------------------------------------------------------

def verdict_template(feature, catches, driven_by="person", asked_codeintel=False):
    minutes = ("minutes-of-your-time: (roughly, answering questions and reviewing)" if driven_by != "agent" else
               "minutes-of-your-time: (an agent drove this run: only the minutes you spent yourself, 0 if none)")
    lines = [
        "# Eval verdict: %s" % feature,
        "",
        "Fill in after the run, then run `feature-flow eval %s` again. One answer after each colon." % feature,
        "",
        "plan: (right | partly | wrong: did the tickets build what you wanted?)",
        "hand-fixes: (how many changes you made by hand after DONE, 0 if none)",
        "would-use-again: (yes | no)",
        minutes,
        "note: ",
    ]
    if asked_codeintel:
        lines += ["codeintel: (helped | no difference | misled: did codeintel's answers help this run?)",
                  "codeintel-note: (an answer it got wrong or could not give, for a codeintel issue)"]
    lines += [
        "",
        "## Catches",
        "",
        "Each check that sent work back. Answer real (a true problem) or false (a false alarm).",
        "",
    ]
    lines += ["%s: " % c for c in catches] or ["(none in this run)"]
    return "\n".join(lines) + "\n"


def read_verdict(path):
    """The filled-in answers, or None when the form is missing or untouched."""
    text = state.read_text(path)
    if text is None:
        return None
    answers, catches = {}, {}
    for line in text.splitlines():
        key, sep, value = line.partition(":")
        value = value.strip()
        if not sep or not value or value.startswith("("):
            continue
        key = key.strip()
        if re.match(r"^\S+ [A-Z-]+ \d+$", key):
            word = re.match(r"[a-z]*", value.lower()).group(0)
            if word in ("real", "false"):
                catches[key] = word
        elif key in ("plan", "hand-fixes", "would-use-again", "minutes-of-your-time", "note", "codeintel",
                     "codeintel-note"):
            answers[key.replace("-", "_")] = value
    if "plan" in answers and answers["plan"].split()[0].lower() not in PLAN_ANSWERS:
        answers["plan_unrecognised"] = answers.pop("plan")
    if not answers and not catches:
        return None
    if catches:
        answers["catches"] = catches
        answers["false_alarms"] = sum(1 for v in catches.values() if v == "false")
        answers["real_catches"] = sum(1 for v in catches.values() if v == "real")
    return answers


# ---- defects found later -----------------------------------------------------------

def later(plan_dir, end):
    """Commits after the run that look like fixes or reverts, on the paths each ticket touched."""
    if end is None:
        return None
    since = end.strftime("%Y-%m-%dT%H:%M:%SZ")
    found = {}
    for path in tickets.ticket_files(plan_dir / "tasks"):
        patterns = lanes.touches(Path(path).read_text(encoding="utf-8", errors="replace")) or []
        paths = [":(glob)" + (p + "**" if p.endswith("/") else p) for p in patterns]
        if not paths:
            continue
        result = git._git("log", "--since=" + since, "--format=%h %s", "--", *paths, check=False)
        hits = [l for l in result.stdout.splitlines() if FIX_WORDS.search(l.split(" ", 1)[-1])]
        if hits:
            found[tickets.number(path)] = hits[:20]
    return {"since": since, "fix_commits": found,
            "note": "commit subjects with fix, revert, bug or regression on each ticket's Touches paths"}


def brainstorm(plan_dir, rows=()):
    """{"picked_by": "person"|"agent", "helpers": {helper: count}, "type": its Type: line} when the plan was
    brainstormed first (plans/<feature>/brainstorm.md), else None."""
    path = Path(plan_dir) / "brainstorm.md"
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    line = next((l for l in text.splitlines() if l.startswith("Picked by:")), "")
    picked = line[len("Picked by:"):].strip().lower()
    helpers = {}
    for _, _, event, _ in rows:
        if event.startswith("BRAINSTORM-"):
            name = event[len("BRAINSTORM-"):].lower()
            helpers[name] = helpers.get(name, 0) + 1
    try:
        kind = brainstorm_mode.parse(text).get("type", "standard")
    except brainstorm_mode.BadMode:
        kind = "unknown"
    return {"picked_by": picked if picked in ("person", "agent") else "unknown", "helpers": helpers, "type": kind,
            "credit": brainstorm_mode.credit(text)}


# ---- the command -----------------------------------------------------------------------

def build(feature, top, out_dir, home, with_later):
    folder = Path(top) / state.STATE_DIR
    text = state.read_text(state.log_path(folder, feature))
    if text is None:
        return None
    rows = timed(text)
    per, totals, human, window = run_summary(rows)
    run_state = state.load(state.state_path(folder, feature))
    spent = run_state.get("spent", "")
    plan_dir = Path(top) / os.environ.get("FLOW_DIR", "plans") / feature
    driven_by = driver(rows, run_state)
    found = list(records(home, top, window))
    totals["settled_at_plan"] = settled_at_plan(plan_dir, per)
    totals["followups"] = followups(plan_dir)
    record = {
        "feature": feature,
        "feature_flow": __version__,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "window": [w.strftime("%Y-%m-%dT%H:%M:%SZ") for w in window] if window else None,
        "active_minutes": int(spent) // 60 if spent.isdigit() else None,
        "totals": totals,
        "tickets": per,
        "driver": driven_by,
        "brainstorm": brainstorm(plan_dir, rows),
        "you": human,
        "tokens": tokens(found, rows),
        "codeintel": codeintel.merge(codeintel.use(item for _, item in found),
                                     codeintel.kept(state.file_path(folder, feature, "codeintel"))),
        "timing": timing(rows, per),
        "verdict": read_verdict(out_dir / VERDICT_FILE),
    }
    if record["tokens"] and totals["lanes"]:
        record["tokens"].pop("by_ticket")
        record["tokens"]["by_ticket_note"] = "not split: lanes ran tickets at the same time"
    if with_later:
        record["later"] = later(plan_dir, window[1] if window else None)
    return record, catch_ids(rows)


def render(record, out_dir, wrote_form):
    t = record["totals"]
    lines = ["eval for %s: %d ticket(s), %d build(s), %d review(s), %d catch(es)%s%s"
             % (record["feature"], t["tickets"], t["builds"], t["reviews"], t["catches"],
                ", gate off (unsafe)" if t.get("gate_off") else "",
                ", floor relaxed: %s" % ", ".join(t["floor_relaxed"]) if t.get("floor_relaxed") else "")]
    if t.get("rebuilds_by_lane"):
        lines.append("  rebuilds after a merge conflict, by lane: " + ", ".join(
            "lane %s x%d" % kv for kv in sorted(t["rebuilds_by_lane"].items())))
    if t["catches_by_check"]:
        lines.append("  caught by: " + ", ".join("%s x%d" % kv for kv in sorted(t["catches_by_check"].items())))
    lines.append("  reworked: %s" % (", ".join(t["reworked"]) or "none"))
    if t.get("settled_at_plan"):
        lines.append("  settled at plan approval (never built): %s" % ", ".join(t["settled_at_plan"]))
    lines.append("  follow-ups: %d in followups.md%s" % (t.get("followups", 0), ", %d deferred check(s)"
                                                         % t["deferred_checks"] if t.get("deferred_checks") else ""))
    if record.get("brainstorm"):
        used = record["brainstorm"].get("helpers") or {}
        kind = record["brainstorm"].get("type", "standard")
        lines.append("  brainstorm: yes%s, the option picked by %s, %s" % (
            "" if kind == "standard" else " (%s)" % kind, record["brainstorm"]["picked_by"], ", ".join(
            "%s x%d" % kv for kv in sorted(used.items())) or "no helpers"))
        credit = record["brainstorm"].get("credit") or {}
        named = sorted(set(used) | set(credit.get("ideas") or {}))
        if credit.get("ideas"):
            lines.append("  helpers' ideas (asked, ideas, in the pick): " + ", ".join(
                "%s %d/%d/%d" % (n, used.get(n, 0), credit["ideas"].get(n, 0), (credit.get("chosen") or {}).get(n, 0))
                for n in named))
    lines.append("  active minutes: %s" % (record["active_minutes"] if record["active_minutes"] is not None else "unknown"))
    tm = record.get("timing")
    if tm:
        lines.append("  wall clock: %d min (%s)" % (tm["wall_minutes"], ", ".join(
            "%s %d" % kv for kv in sorted(tm["by_phase"].items(), key=lambda kv: -kv[1]))))
        if tm["slowest"]:
            lines.append("  slowest ticket: %(ticket)s, %(minutes)d min, most of it in %(most_in)s" % tm["slowest"])
        if tm["full_test_runs"]:
            lines.append("  whole Test runs by the gate: " + ", ".join("%s x%d" % kv for kv in tm["full_test_runs"].items()))
        if tm.get("gate_minutes"):
            lines.append("  gate minutes by command: " + ", ".join("%s %s" % kv for kv in tm["gate_minutes"].items()))
    tok = record["tokens"]
    if tok:
        total = tok["total"]
        lines.append("  tokens: %d input, %d output, %d cache read, %d cache write (from %d transcript file(s))"
                     % (total.get("input", 0), total.get("output", 0), total.get("cache_read", 0),
                        total.get("cache_write", 0), tok["files"]))
    else:
        lines.append("  tokens: not found (no Claude Code transcripts for this repo in the run window,"
                     " or a log from before 0.15.0)")
    ci = record.get("codeintel")
    if ci:
        lines.append("  codeintel: %d quer%s (%s); the agents said %s" % (
            sum(ci["queries"].values()), "y" if sum(ci["queries"].values()) == 1 else "ies",
            ", ".join("%s x%d" % kv for kv in sorted(ci["queries"].items())) or "none seen",
            ", ".join("%s x%d" % (v, ci["said"][v]) for v in codeintel.VERDICTS if ci["said"].get(v)) or "nothing"))
    you = record["you"]
    if you.get("guided_stops"):
        lines.append("  guided stops: %d (%s; the aim is 3 or fewer)" % (len(you["guided_stops"]), ", ".join(you["guided_stops"])))
    lines.append("  %s: %d stop(s), %d question(s), %d handoff(s), %d reset(s)"
                 % ("needed the driving agent (not you)" if record.get("driver") == "agent" else "needed you",
                    len(you["stops"]), you["questions_to_user"], you["handoffs"], you["resets"]))
    verdict = record["verdict"]
    if verdict:
        lines.append("  your verdict: plan %s, %s hand fix(es), %s real catch(es), %s false alarm(s)"
                     % (verdict.get("plan", "?"), verdict.get("hand_fixes", "?"),
                        verdict.get("real_catches", "?"), verdict.get("false_alarms", "?"))
                     + (", codeintel %s" % verdict["codeintel"] if verdict.get("codeintel") else ""))
    elif wrote_form:
        lines.append("  fill in %s, then run eval again" % (out_dir / VERDICT_FILE))
    else:
        lines.append("  your verdict: not filled in yet (%s)" % (out_dir / VERDICT_FILE))
    if "later" in record:
        later_part = record["later"]
        hits = later_part["fix_commits"] if later_part else {}
        lines.append("  fixes since the run: %s" % (", ".join("%s x%d" % (n, len(h)) for n, h in sorted(hits.items())) or "none"))
    lines.append("wrote %s" % (out_dir / "eval.json"))
    return "\n".join(lines) + "\n"


def main(argv, out=None, err=None):
    out = out or sys.stdout
    err = err or sys.stderr
    args, out_dir, home, with_later, others = [], None, None, False, []
    rest = list(argv)
    while rest:
        arg = rest.pop(0)
        if arg == "--later":
            with_later = True
        elif arg == "--compare" and rest:
            while rest and not rest[0].startswith("-"):
                others.append(rest.pop(0))
        elif arg in ("--out", "--claude-home") and rest:
            value = rest.pop(0)
            if arg == "--out":
                out_dir = value
            else:
                home = value
        elif arg.startswith("-"):
            err.write(USAGE + "\n")
            return 2
        else:
            args.append(arg)
    if len(args) != 1:
        err.write(USAGE + "\n")
        return 2
    feature = args[0]
    top = git.toplevel()
    if top is None:
        err.write("not inside a git repo\n")
        return 2
    out_dir = Path(out_dir) if out_dir else Path(top) / os.environ.get("FLOW_DIR", "plans") / feature
    built = build(feature, top, out_dir, claude_home(home), with_later)
    if built is None:
        path = state.log_path(Path(top) / state.STATE_DIR, feature)
        err.write("no run log for %s (%s)\n" % (feature, path))
        err.write(suggest.hint(feature, [p.name[5:-4] for p in path.parent.glob("flow-*.log")]))
        return 2
    record, catches = built
    out_dir.mkdir(parents=True, exist_ok=True)
    form = out_dir / VERDICT_FILE
    wrote_form = not form.exists()
    if wrote_form:
        form.write_text(verdict_template(feature, catches, record["driver"], bool(record["codeintel"])),
                        encoding="utf-8")
    (out_dir / "eval.json").write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    out.write(render(record, out_dir, wrote_form))
    if others:
        out.write(compare(record, others, err))
    return 0


def compare(record, paths, err):
    """A table of this run beside earlier runs' eval.json files: wall clock, where it went, builds, reviews,
    catches and stops, so a change to the flow can be seen to save time or not."""
    runs = [("this run", record)]
    for path in paths:
        try:
            runs.append((path, json.loads(Path(path).read_text(encoding="utf-8"))))
        except (OSError, ValueError) as problem:
            err.write("cannot read %s: %s\n" % (path, problem))
    lines = ["compare:"]
    for name, rec in runs:
        t, tm = rec.get("totals", {}), rec.get("timing") or {}
        phases = tm.get("by_phase", {})
        lines.append("  %s: %s, %s min wall (build %s, checks %s, review %s, waiting %s), %s ticket(s), %s build(s), "
                     "%s review(s), %s catch(es), %s stop(s)" % (
                         name, rec.get("feature", "?"), tm.get("wall_minutes", "?"), phases.get("build", 0),
                         phases.get("checks", 0), phases.get("review", 0), phases.get("waiting", 0),
                         t.get("tickets", "?"), t.get("builds", "?"), t.get("reviews", "?"), t.get("catches", "?"),
                         len((rec.get("you") or {}).get("stops", []))))
    return "\n".join(lines) + "\n"
