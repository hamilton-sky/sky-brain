"""The guided flow's one page: the brainstorm, and later the plan and the build, as one review page that grows.

The page has five steps, Style, Team, Options, Plan and Build, each a Forkboard step (packages/forkboard/, doc.py)
shown as a tab: a done step shows its one-line summary and a Change button, the current one is open with an Approve
button, a later one is greyed. Style holds the brainstorm's type and its scout levels, Team its helpers, Options a
pick of the drafted options, and Plan the build flow's choices. On a live page a pick waits until the user approves
its step; the Approve saves the step's picks and its approval in the page's state, which wakes the session, and
`apply_picks` writes them into the brainstorm's header lines (`Type:`, `Scouts:`, `Helpers:`), the only lines of the
brainstorm the page ever writes. Which steps are approved comes from the page's state (`approved`), so the steps
move on one Approve at a time. The session publishes the page to the same link at every stop, so there is one page.
"""

import os

from feature_flow import brainstorm_mode

STEPS = ("Style", "Team", "Options", "Plan", "Build")
STYLE_SECTIONS = ("idea", "sketch")  # the brainstorm's sections that belong to Style; the rest are Options
LEVEL_LABELS = {"off": "Off", "light": "Light", "normal": "Normal", "deep": "Deep"}
HELPER_LABELS = {"architect": "Architect", "designer": "Designer", "po": "Product owner", "skeptic": "Skeptic",
                 "positive": "Positive", "researcher": "Researcher", "open-minded": "Open-minded",
                 "artistic": "Artistic", "ux": "UX", "security": "Security"}
HELPER_NOTES = {"architect": "does an option fit the module boundaries and the data shapes?",
                "designer": "how does an option look and behave for the person who uses it?",
                "po": "what does an option give the user, and what can be cut?",
                "skeptic": "the strongest objection to each finished option",
                "positive": "the best case for each option", "researcher": "what the evidence says",
                "open-minded": "the option nobody drafted", "artistic": "how it feels to the person who meets it",
                "ux": "usability and accessibility", "security": "what a hostile caller or a mistake could do"}
LEVEL_NOTES = {"code": {"off": "no code scouts: the brainstorm works from what you tell it",
                        "light": "one scout takes a quick look at the code",
                        "normal": "the usual look: scouts read the parts of the code the idea touches",
                        "deep": "up to three scouts map the code widely; slower"},
               "web": {"off": "no web search",
                       "light": "one quick search for how others do it",
                       "normal": "the usual search: prior art and the docs of the tools involved",
                       "deep": "up to two searches that go wider; slower"}}
CONSULT = ("architect", "designer", "po")
PICK_KEYS = ("type", "code", "web", "consult", "skeptic", "lens")
STYLE_KEYS = ("type", "code", "web")
OPTION_KEY = "option"  # the Options step's pick: the session writes it as Chosen (brainstorm guide, Step 4)
PLAN_KEYS = ("profile", "lanes", "gate", "full_review")  # flow_plan.PLAN_KEYS


def is_plan_key(key):  # flow_plan.is_plan_key: builder-<NN> is the Plan step's too
    return key in PLAN_KEYS or key.startswith("builder-")


def profile(environ=None):
    environ = os.environ if environ is None else environ
    return "careful" if environ.get("FLOW_PROFILE", "").strip().lower() == "careful" else "normal"


def setup_of(text, environ=None):
    """(mode, levels {code, web}, helpers, caps) the brainstorm's header sets, with the type's defaults filled in."""
    environ = os.environ if environ is None else environ
    mode = brainstorm_mode.parse(text)
    kind = mode.get("type") or "standard"
    levels = {k: brainstorm_mode.level(k, environ, (), mode) for k in brainstorm_mode.KINDS}
    caps = brainstorm_mode.limits(profile(environ), levels, kind)
    helpers = mode.get("helpers")
    if helpers is None:
        helpers = brainstorm_mode.TYPES[kind]["helpers"]
    return mode, levels, tuple(helpers), caps


def summary(kind, levels, helpers):
    return "type %s, scouts code=%s web=%s, helpers %s" % (kind, levels["code"], levels["web"],
                                                           brainstorm_mode.helpers_text(helpers))


def style_summary(kind, levels):
    return "type %s, scouts code=%s web=%s" % (kind, levels["code"], levels["web"])


def team_summary(helpers):
    return "helpers %s" % brainstorm_mode.helpers_text(helpers)


def setup_section(text, environ=None):
    """The Style and Team steps' own sections: the choices, with what the header says now as their values."""
    mode, levels, helpers, caps = setup_of(text, environ)
    kind = mode.get("type") or "standard"
    levels_options = lambda kind: [{"value": v, "label": LEVEL_LABELS[v], "note": LEVEL_NOTES[kind][v]}
                                    for v in brainstorm_mode.LEVELS]
    choices = [
        {"key": "type", "label": "Type", "kind": "one", "value": kind,
         "about": "How the brainstorm runs. Pick by what you know already.",
         "options": [{"value": t, "label": t.capitalize(), "note": brainstorm_mode.TYPES[t]["about"]}
                     for t in brainstorm_mode.TYPES]},
        {"key": "code", "label": "Code scouts", "kind": "one", "value": levels["code"], "options": levels_options("code"),
         "about": "How far read-only scouts look through this repository before the options are drafted."},
        {"key": "web", "label": "Web scouts", "kind": "one", "value": levels["web"], "options": levels_options("web"),
         "about": "How far a scout looks on the web for prior art and docs."},
    ]
    for key, label, names in (("consult", "Consultants", CONSULT), ("skeptic", "Skeptic", ("skeptic",)),
                              ("lens", "Lenses", brainstorm_mode.LENSES)):
        top = caps[key]
        picked = [n for n in helpers if n in names][:top]
        choices.append({"key": key, "label": label, "kind": "some", "max": top, "value": picked,
                        "about": {"consult": "Consultants read the options and advise. All read only.",
                                  "skeptic": "One helper who argues against each option.",
                                  "lens": "A lens looks at every option from one angle."}[key],
                        "options": [{"value": n, "label": HELPER_LABELS[n], "note": HELPER_NOTES[n]} for n in names],
                        "note": "Your profile and type allow none." if top == 0 else ""})
    style = ("Who the brainstorm is for and how far the scouts look. The type sets the helpers the Team step "
             "starts from.")
    team = ("Which helpers look at the options. The limits come from the %s profile and the %s type."
            % (profile(environ), kind))
    return [{"title": "Style", "kind": "text", "markdown": style, "items": [], "step": "Style",
             "choices": [c for c in choices if c["key"] in STYLE_KEYS]},
            {"title": "Team", "kind": "text", "markdown": team, "items": [], "step": "Team",
             "choices": [c for c in choices if c["key"] not in STYLE_KEYS]}]


def option_choice(options, picked):
    """The Options step's pick: one of the drafted options, by its letter."""
    items = [i for i in (options or {}).get("items") or [] if i.get("label")]
    if not items:
        return []
    return [{"key": OPTION_KEY, "label": "Option", "kind": "one", "value": picked or None,
             "options": [{"value": i["label"], "label": i.get("title") or i["label"]} for i in items]}]


def folders(top, feature, environ=None):
    """(the draft plan's folder or None, the accepted plan's folder or None)."""
    environ = os.environ if environ is None else environ
    from pathlib import Path
    draft = Path(top) / ".feature-flow" / "state" / "draft" / feature
    plan = Path(top) / (environ.get("FLOW_DIR") or "plans") / feature
    return (draft if (draft / "tasks").is_dir() else None), (plan if (plan / "tasks").is_dir() else None)


def document(base, text, environ=None, top=None, feature=None, approved=None):
    """The brainstorm page's document (brainstorm_page.document) as the guided flow's page: the Style and Team
    sections and the five steps, with each of the brainstorm's sections under Style or Options, and once there is a
    plan (a draft, then the accepted one) its Plan and Build steps (feature_flow/flow_plan.py). approved is the set
    of steps the live page's state says the user approved, or None for a page that is not live (then Style and Team
    are open together, and the user answers in the chat)."""
    mode, levels, helpers, _ = setup_of(text, environ)
    kind = mode.get("type") or "standard"
    sections = base.get("sections") or []
    titles = {s.get("title", "").lower(): s for s in sections}
    options = titles.get("options")
    has_options = bool(options and options.get("items"))
    chosen = titles.get("chosen")
    picked = bool(chosen and chosen.get("markdown", "").strip() and not chosen["markdown"].strip().startswith("<"))
    verdict = titles.get("verdict")
    for section in sections:
        section["step"] = "Style" if section.get("title", "").lower() in STYLE_SECTIONS else "Options"
    pick = next((i["label"] for i in (options or {}).get("items") or [] if i.get("chosen")), "")
    if has_options:
        options["choices"] = option_choice(options, pick)
    live = approved is not None
    approved = set(approved or ())
    if has_options:
        style_state = team_state = "done"
    elif not live:
        style_state = team_state = "current"
    else:
        style_state = "done" if "Style" in approved else "current"
        team_state = "later" if style_state == "current" else "done" if "Team" in approved else "current"
    steps = [
        {"name": "Style", "state": style_state, "summary": style_summary(kind, levels)},
        {"name": "Team", "state": team_state, "summary": team_summary(helpers)},
        {"name": "Options", "state": "done" if picked else "current" if has_options or team_state == "done" and live
         else "later",
         "summary": ("picked %s" % pick if pick else "picked") if picked else
         "%d options" % len(options["items"]) if has_options else
         "Claude is writing the options" if team_state == "done" and live else ""},
        {"name": "Plan", "state": "later", "summary": ""},
        {"name": "Build", "state": "later", "summary": ""},
    ]
    extra = []
    draft, plan = folders(top, feature, environ) if top and feature else (None, None)
    if plan or draft:
        from feature_flow import flow_plan
        said, extra = flow_plan.sections(plan or draft, draft=plan is None, environ=environ)
        steps[3].update(state="done" if plan else "current", summary=("approved: " if plan else "") + said)
        if plan:
            state_, summary_, found = flow_plan.build_section(plan)
            steps[4].update(state=state_, summary=summary_)
            extra.extend(found)
        for step in steps[:3]:
            step["state"] = "done"
    if kind == "explore" and verdict is not None:
        steps = steps[:3]  # explore ends at its Go or No-go
    base["steps"] = steps
    first = [x for x in sections if x["step"] == "Style"]  # the idea, then the choices about it
    base["sections"] = first + setup_section(text, environ) + [x for x in sections if x["step"] != "Style"] + extra
    return base


def apply_picks(text, picks, environ=None):
    """The brainstorm with the picks written into its header lines, and the lines written. ValueError, and nothing
    written, for a pick it does not know or one past the limits."""
    picks = {k: v for k, v in picks.items() if not is_plan_key(k) and k != OPTION_KEY}  # the Plan step's, written by
    # flow_plan, and the Options step's, which the session writes as Chosen
    unknown = sorted(set(picks) - set(PICK_KEYS))
    if unknown:
        raise ValueError("the page picked %s, which the brainstorm has no line for" % ", ".join(unknown))
    kind = picks.get("type", brainstorm_mode.parse(text).get("type") or "standard")
    if kind not in brainstorm_mode.TYPES:
        raise ValueError("Type: must be %s, not %s" % (", ".join(brainstorm_mode.TYPES), kind))
    lines = {"Type": kind}
    mode, levels, helpers, _ = setup_of(header_lines(text, lines), environ)  # a new type brings its own defaults
    if "code" in picks or "web" in picks or "code" in mode or "web" in mode:
        new = dict(levels, **{k: picks[k] for k in brainstorm_mode.KINDS if k in picks})
        for k in brainstorm_mode.KINDS:
            if new[k] not in brainstorm_mode.LEVELS:
                raise ValueError("Scouts: %s= must be %s, not %s" % (k, ", ".join(brainstorm_mode.LEVELS), new[k]))
        lines["Scouts"] = "code=%s web=%s" % (new["code"], new["web"])
    groups = {"consult": CONSULT, "skeptic": ("skeptic",), "lens": brainstorm_mode.LENSES}
    chosen = []
    for key, names in groups.items():
        value = picks.get(key, [n for n in helpers if n in names])
        if not isinstance(value, list) or not all(isinstance(v, str) and v in names for v in value):
            raise ValueError("the page's %s pick must be a list of %s, not %r" % (key, ", ".join(names), value))
        chosen += value
    lines["Helpers"] = brainstorm_mode.helpers_text(chosen)
    out = header_lines(text, lines)
    mode, levels, helpers, caps = setup_of(out, environ)  # the whole header again, as the script will read it
    too_many = brainstorm_mode.over(helpers, caps)
    if too_many:
        raise ValueError("the page picked %d %s helper(s), and %s with type %s allows %d" % (
            too_many[1], too_many[0], profile(environ), mode.get("type") or "standard", too_many[2]))
    return out, lines


def header_lines(text, values):
    """text with each `Key: value` header line (before the first `## `) set, adding the ones it lacks."""
    head, sep, rest = text.partition("\n## ")
    kept, seen = [], set()
    for line in head.split("\n"):
        key = line.partition(":")[0].strip()
        if key in values and ":" in line:
            if key not in seen:
                kept.append("%s: %s" % (key, values[key]))
                seen.add(key)
            continue
        kept.append(line)
    missing = ["%s: %s" % (k, v) for k, v in values.items() if k not in seen]
    if missing:
        last = max((i for i, l in enumerate(kept) if l.partition(":")[0].strip() in
                    ("Picked by", "Style", "Type", "Scouts", "Helpers") and ":" in l), default=None)
        if last is None:
            last = next((i for i, l in enumerate(kept) if l.startswith("# ")), -1)
            missing = ([""] if last >= 0 else []) + missing
        kept[last + 1:last + 1] = missing
    return "\n".join(kept) + (sep + rest if sep else "")
