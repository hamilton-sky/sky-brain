"""The Plan and Build steps of the guided flow's page (feature_flow/flow_page.py), and the plan-yes card's choices.

The Plan step shows the drafted plan: its tickets and their order, the build flow (each ticket's level and review),
how many tickets can build at once (lanes.plan_width) and the checks every ticket must pass. Its choices are the
profile, the lanes and which tickets get a full review. While the plan is a draft (.feature-flow/state/draft/), the
page's picks are written into the draft's commands.md (`Profile:`, `Lanes:`) and tickets (`Review: full`), so one
yes approves the plan and its build flow together and they are frozen with it. An accepted plan only shows: change
it with a re-plan. The Build step shows how far the run is.
"""

import re
from pathlib import Path

from feature_flow import builders, gate, lanes, profiles, reality, status, tickets

PLAN_KEYS = ("profile", "lanes", "gate", "full_review")
GATE_CHOICES = ("each", "batch 2", "batch 3", "batch 5", "end")
GATE_NOTES = {"each": "the full gate, Done when and a review after every ticket",
              "end": "cheap checks after each ticket; the full gate, Done when and one review at the end",
              "batch": "cheap checks after each ticket; the full gate, Done when and one review every %s tickets"}
BUILDER_NOTES = {"frontend": "user interface code: reuse the folder's components and styles",
                 "backend": "server, library or command line code: check every outside input where it enters",
                 "docs": "documentation: every command, flag and path named must exist in the code"}
BUILDER_KEY = "builder-"  # builder-<NN>: one pick per ticket, its Builder: line


def is_plan_key(key):
    return key in PLAN_KEYS or key.startswith(BUILDER_KEY)
PROFILE_NOTES = {"fast": "one builder takes small tickets in batches, and one review of the whole feature at the end",
                 "standard": "two reviewers side by side on each ticket, and one review of the whole round",
                 "careful": "the full gate and two reviewers on every ticket, and at most 2 lanes",
                 "normal": "one review per ticket"}
LANE_CAPS = {"careful": 2, "fast": 1}  # as conductor.guards.LANE_CAPS, and fast batches instead of lanes
CHECKS = ("gate", "floor guard", "footprint", "done when", "test first")


class Plan:
    """A plan folder (the draft, or the accepted plan) read for the page."""

    def __init__(self, folder):
        self.folder = Path(folder)
        self.commands = self.folder / "commands.md"
        self.graph = tickets.Graph(tickets.ticket_files(self.folder / "tasks"))

    def value(self, key):
        return tickets.commands_value(self.commands, key).strip()

    def profile(self):
        return (self.value("Profile") or "normal").lower()

    def width(self):
        return status.width_of(self.graph, str(self.commands))

    def gate(self):
        """The plan's gate cadence (each, batch N, end), with the profile's default; "off unsafe" when it is off."""
        from feature_flow.conductor.settings import gate_every
        try:
            on, every = gate_every(self.value("Gate"), self.profile())
        except ValueError:
            return "each"
        return "off unsafe" if not on else "each" if every == 1 else "end" if every == 0 else "batch %d" % every

    def lanes_cap(self, profile=None):
        return LANE_CAPS.get(profile or self.profile(), lanes.MAX_LANES_PLAN)

    def full_review(self):
        g = self.graph
        return [g.lab[t] for t in g.order if g.review.get(t) == "full"]


def flowchart(plan):
    g = plan.graph
    lines = ["flowchart TD"]
    for t in g.order:
        title = re.sub(r"[\[\]\"|{}()<>]", " ", g.title[t]).strip() or g.lab[t]
        lines.append('  T%s["%s"]' % (g.lab[t], title[:60]))
    for t in g.order:
        for b in g.blk[t]:
            if b in g.seen:
                lines.append("  T%s --> T%s" % (g.lab[b], g.lab[t]))
    return "\n".join(lines)


def plan_gate_default(profile):
    from feature_flow.conductor.settings import GATE_DEFAULTS
    return GATE_DEFAULTS.get(profile, "each")


def gate_note(cadence):
    if cadence.startswith("batch "):
        return GATE_NOTES["batch"] % cadence.split()[1]
    return GATE_NOTES.get(cadence, "")


def checks_text(plan):
    """The checks every ticket must pass, as markdown: the gate's commands, and what the plan relaxed or turned off."""
    from feature_flow import floorguard
    gate_cmds = [k for k in gate.KEYS + ("Quick",) if plan.value(k)] + ["Check %s" % p for p, _ in
                                                                      gate.path_checks(plan.commands)]
    cadence = plan.gate()
    off = cadence == "off unsafe"
    cats, why, problem = floorguard.plan_allow(plan.commands.read_text(encoding="utf-8") if plan.commands.is_file() else "")
    out = ["- **Gate**: %s" % ("**off (unsafe)**: no command runs after a build" if off else
                                ", ".join("`%s`" % c for c in gate_cmds) or "no commands")]
    if not off:
        out.append("- **When**: `Gate: %s`, %s" % (cadence, gate_note(cadence)))
    out.append("- **Floor guard**: %s" % (problem if problem else "relaxed for %s, because %s" % (cats, why) if cats
                                          else "skipped or deleted tests, silenced checks and edited config fail"))
    out.append("- **Footprint**: a build may change only its ticket's `Touches:` paths")
    first = [plan.graph.lab[t] for t in plan.graph.order if plan.graph.tf.get(t) == "yes"]
    out.append("- **Done when**: each ticket's check block%s" % (
        ", off with the gate" if off else "" if cadence == "each" else ", run at the checkpoint"))
    out.append("- **Test first**: %s" % ("tickets %s prove a failing test first" % ", ".join(first) if first else "no ticket asks for it"))
    return "\n".join(out)


def sections(folder, draft, environ=None):
    """(the Plan step's summary, its sections) for the plan in folder; draft says whether its picks can be written."""
    plan = Plan(folder)
    g = plan.graph
    profile = plan.profile()
    wide, waits = plan.width()
    lanes_value = (plan.value("Lanes") or "1").lower()
    rows = ["| Ticket | Level | Review | Touches |", "|---|---|---|---|"]
    for t in g.order:
        review = "full: spec, then quality" if g.review.get(t) == "full" else profile
        rows.append("| %s %s | %s | %s | %s |" % (g.lab[t], g.title[t].replace("|", "/"), g.level.get(t, "-"), review,
                                                ", ".join("`%s`" % p for p in g.touches.get(t, [])) or "none"))
    width_md = "Up to %d ticket%s can build at once." % (wide, "" if wide == 1 else "s")
    if waits:
        width_md += " " + "; ".join("%s waits for %s: %s" % (g.lab[t], g.lab[o], why) for t, o, why in waits[:6]) + "."
    plan_md = "%d tickets. %s\n\n```mermaid\n%s\n```\n\n%s" % (len(g.order), width_md, flowchart(plan), "\n".join(rows))
    cap = min(wide or 1, plan.lanes_cap())
    lanes_options = [{"value": "auto", "label": "Auto (%d)" % max(1, cap)}] + [
        {"value": str(n), "label": str(n)} for n in range(1, lanes.MAX_LANES_PLAN + 1)]
    choices = [
        {"key": "profile", "label": "Profile", "kind": "one", "value": profile if profile in profiles.PROFILES else "normal",
         "about": "How much review each ticket gets while it builds.",
         "options": [{"value": p, "label": p.capitalize(), "note": PROFILE_NOTES.get(p, "")} for p in
                     ("fast", "standard", "careful", "normal")]},
        {"key": "lanes", "label": "Tickets building at once", "kind": "one",
         "value": lanes_value if lanes_value in ("auto", "1", "2", "3", "4") else "1", "options": lanes_options,
         "about": "Tickets that touch different files can build side by side, each in its own worktree.",
         "note": "Auto takes the plan's width, at most %d with this profile. FLOW_LANES still overrides it." % plan.lanes_cap()},
    ]
    cadence = plan.gate()
    if cadence != "off unsafe":
        choices.append({"key": "gate", "label": "When the full gate and review run", "kind": "one",
                        "about": "The gate runs your test command and checks; sooner catches a break sooner, later is faster.",
                        "value": cadence, "options": [{"value": v, "label": v.capitalize(), "note": gate_note(v)} for v in
                                                      GATE_CHOICES + (() if cadence in GATE_CHOICES else (cadence,))],
                        "note": "The %s profile's default is %s. A level 3 ticket keeps its own review either way."
                                % (profile, plan_gate_default(profile))})
    choices += [
        {"key": "full_review", "label": "Tickets with a full review (spec, then quality)", "kind": "some",
         "about": "A full review checks the ticket against its spec first, then its code quality. Pick the risky ones.",
         "value": plan.full_review(), "options": [{"value": g.lab[t], "label": "%s %s" % (g.lab[t], g.title[t])}
                                                  for t in g.order]},
    ]
    for t in g.order:
        hint = builders.suggest(g.touches.get(t))
        choices.append({"key": BUILDER_KEY + g.lab[t], "label": "Builder notes for %s %s" % (g.lab[t], g.title[t]),
                        "kind": "one", "value": g.builder.get(t, "none") if g.builder.get(t) in builders.NAMES else "none",
                        "options": [{"value": "none", "label": "None"}] + [
                            {"value": n, "label": n.capitalize()} for n in builders.NAMES],
                        "note": "Its paths suggest %s." % hint if hint else "Its paths suggest none."})
    build_md = checks_text(plan) + ("\n\nAdd a check by asking in the chat: a `Typecheck:`, `Security:` or `Check <path>:` "
                                    "line goes into commands.md. Relaxing one needs a reason, and turning the gate off is "
                                    "marked unsafe.\n\nBuilder notes add a short guide to one ticket's build: %s."
                                    % "; ".join("**%s**, %s" % (n.capitalize(), BUILDER_NOTES[n]) for n in builders.NAMES)
                                    if draft else "")
    out = [{"title": "Plan", "kind": "text", "markdown": plan_md, "items": [], "step": "Plan",
            "ask_about": ["%s %s" % (g.lab[t], g.title[t]) for t in g.order]},
           {"title": "Build flow", "kind": "text", "markdown": build_md, "items": [], "step": "Plan",
            "choices": choices if draft else []}]
    lanes_said = "lanes auto (%d)" % max(1, cap) if lanes_value == "auto" else "%s lane%s" % (lanes_value, "" if lanes_value == "1" else "s")
    return "%d tickets, %s, %s" % (len(g.order), profile, lanes_said), out


def build_section(folder):
    """(the Build step's state and summary, its sections: the ticket statuses, then plan vs reality once a build ran) from the accepted plan's ticket statuses."""
    g = Plan(folder).graph
    done = sum(1 for t in g.order if g.stat[t] in ("resolved", "parked"))
    state = "done" if g.order and done == len(g.order) else "current"
    summary = "%d of %d tickets done" % (done, len(g.order))
    rows = ["| Ticket | Status |", "|---|---|"] + ["| %s %s | %s |" % (g.lab[t], g.title[t].replace("|", "/"), g.stat[t])
                                                   for t in g.order]
    out = [{"title": "Build", "kind": "text", "markdown": "\n".join(rows), "items": [], "step": "Build"}]
    items, run = reality.for_plan(folder, Path(folder).name)
    if any(item["changed"] is not None for item in items):
        out.append({"title": "Plan vs reality", "kind": "text", "markdown": reality.markdown(items, run), "items": [],
                    "step": "Build"})
    return state, summary, out


def set_header(text, key, value):
    """A ticket's or commands.md's `Key: value` line set (added after the title block when missing), or removed
    when value is None."""
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if line.startswith("## "):
            break
        if line.startswith(key + ":"):
            if value is None:
                del lines[i]
            else:
                lines[i] = "%s: %s" % (key, value)
            return "\n".join(lines)
    if value is None:
        return text
    at = next((i for i, l in enumerate(lines) if l.startswith("Status:")), None)
    if at is None:
        at = next((i for i, l in enumerate(lines) if l.startswith("## ")), len(lines)) - 1
        while at > 0 and lines[at] == "":
            at -= 1
    lines.insert(at + 1, "%s: %s" % (key, value))
    return "\n".join(lines)


def apply_picks(folder, picks):
    """Write the Plan step's picks into the draft in folder: [what it wrote]. ValueError, and nothing written, for a
    pick it does not know or one the plan cannot take."""
    plan = Plan(folder)
    g = plan.graph
    writes = {}
    text = plan.commands.read_text(encoding="utf-8") if plan.commands.is_file() else ""
    said = []
    if "profile" in picks:
        if picks["profile"] not in profiles.PROFILES:
            raise ValueError("the profile must be %s, not %s" % (", ".join(sorted(profiles.PROFILES)), picks["profile"]))
        text = set_header(text, "Profile", "`%s`" % picks["profile"])
        said.append("Profile: %s" % picks["profile"])
    if "lanes" in picks:
        value = str(picks["lanes"])
        wide = plan.width()[0]
        if value != "auto" and (not value.isdigit() or not 1 <= int(value) <= lanes.MAX_LANES_PLAN):
            raise ValueError("lanes must be auto or 1 to %d, not %s" % (lanes.MAX_LANES_PLAN, value))
        if value != "auto" and int(value) > max(1, wide):
            raise ValueError("the plan can build only %d ticket(s) at once, so %s lanes would wait" % (wide, value))
        text = set_header(text, "Lanes", "`%s`" % value)
        said.append("Lanes: %s" % value)
    if "gate" in picks:
        from feature_flow.conductor.settings import gate_every
        value = " ".join(str(picks["gate"]).lower().split())
        if plan.gate() == "off unsafe":
            raise ValueError("the plan turns the gate off (`Gate: off unsafe`): turn it on by asking in the chat first")
        if value == "off unsafe":
            raise ValueError("the gate is turned off only by asking in the chat, never from the card")
        try:
            gate_every(value, plan.profile())
        except ValueError as err:
            raise ValueError(str(err).replace("commands.md's Gate: line", "the gate"))
        old_profile, new_profile = plan.profile(), str(picks.get("profile", plan.profile())).lower()
        shown = not plan.value("Gate") and value == plan_gate_default(old_profile)  # the card's default, not a pick
        if value == plan_gate_default(new_profile) or (shown and new_profile != old_profile):
            text = set_header(text, "Gate", None)  # the profile's default: it follows the profile
            said.append("Gate: %s (the %s default)" % (plan_gate_default(new_profile), new_profile))
        else:
            text = set_header(text, "Gate", "`%s`" % value)
            said.append("Gate: %s" % value)
    writes[plan.commands] = text
    if "full_review" in picks:
        wanted = picks["full_review"]
        labels = {g.lab[t]: t for t in g.order}
        if not isinstance(wanted, list) or not all(isinstance(w, str) and w in labels for w in wanted):
            raise ValueError("full_review must be a list of the plan's tickets (%s), not %r" % (", ".join(labels), wanted))
        for label, t in labels.items():
            path = Path(g.path[t])
            old = path.read_text(encoding="utf-8")
            if label in wanted:
                new = set_header(old, "Review", "full")
            else:
                new = set_header(old, "Review", None) if g.review.get(t) == "full" else old
            if new != old:
                writes[path] = new
        said.append("Review: full on %s" % (", ".join(wanted) or "no ticket"))
    labels = {g.lab[t]: t for t in g.order}
    for key in sorted(k for k in picks if k.startswith(BUILDER_KEY)):
        label, name = key[len(BUILDER_KEY):], picks[key]
        if label not in labels:
            raise ValueError("the plan has no ticket %s for %s" % (label, key))
        if name not in builders.NAMES + ("none",):
            raise ValueError("a builder must be none or %s, not %r" % (", ".join(builders.NAMES), name))
        path = Path(g.path[labels[label]])
        old = writes.get(path, path.read_text(encoding="utf-8"))
        new = set_header(old, "Builder", None if name == "none" else name)
        if new != old:
            writes[path] = new
        said.append("Builder: %s on %s" % (name, label))
    unknown = sorted(k for k in picks if not is_plan_key(k))
    if unknown:
        raise ValueError("the Plan step has no pick %s" % ", ".join(unknown))
    for path, text in writes.items():
        path.write_text(text, encoding="utf-8")
    return said
