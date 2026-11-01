"""Brainstorm types and scout levels: chosen once, written into the brainstorm, and followed by the run.

A type says who the brainstorm is for, and sets how far the code and web scouts look and which helpers the
brainstorm may use. Both are header lines of the brainstorm file, beside `Style:` and `Picked by:`:

    Type: learn
    Scouts: code=light web=deep

The file is `.feature-flow/state/brainstorm-<feature>.md` until the plan exists and then
`plans/<feature>/brainstorm.md`, so the scouts of the plan and the build follow the same choice.
"""

import re
from pathlib import Path

LEVELS = ("off", "light", "normal", "deep")
KINDS = ("code", "web")  # code: flow-scout, web: flow-web
AGENTS = {"flow-scout": "code", "flow-web": "web"}
LENSES = ("positive", "researcher", "open-minded", "artistic", "ux", "security")  # guides/lenses/<name>.md
HELPER_NAMES = ("scout", "web", "architect", "designer", "po", "skeptic") + LENSES
STOPS = ("setup", "options", "plan")  # the guided flow's three stops: the start card, the brainstorm page, the plan yes
TAG = re.compile(r"\[(%s)\](?!\()" % "|".join(re.escape(n) for n in HELPER_NAMES))

TYPES = {
    "standard": {"about": "you know the domain and the codebase", "code": "normal", "web": "normal",
                 "helpers": ("architect", "skeptic")},
    "learn": {"about": "you are new to the domain: each idea is explained as it comes, with a cited glossary",
              "code": "light", "web": "deep", "helpers": ("po", "skeptic")},
    "map": {"about": "you know the domain but not this code: the scouts map the repository first",
            "code": "deep", "web": "light", "helpers": ("architect", "skeptic")},
    "quick": {"about": "you know both and want it short: one look, one or two options, then the brief",
              "code": "light", "web": "light", "consult": 1, "skeptic": 0, "lens": 0, "helpers": ("architect",)},
    "explore": {"about": "you are not sure it is worth building: it ends in a go or no-go, not a brief",
                "code": "light", "web": "normal", "helpers": ("po", "skeptic")},
}

# helpers per brainstorm, by profile; a scout level other than normal replaces the scout and web rows
LIMITS = {"normal": {"scout": 2, "web": 1, "consult": 2, "skeptic": 1, "lens": 2},
          "careful": {"scout": 3, "web": 2, "consult": 3, "skeptic": 1, "lens": 3}}
LEVEL_LIMITS = {"scout": {"off": 0, "light": 1, "deep": 3}, "web": {"off": 0, "light": 1, "deep": 2}}  # deep: the careful row


class BadMode(ValueError):
    pass


def _check(key, value):
    value = value.strip().lower()
    if key == "type" and value not in TYPES:
        raise BadMode("Type: must be %s, not %s" % (", ".join(TYPES), value or "empty"))
    if key in KINDS and value not in LEVELS:
        raise BadMode("Scouts: %s= must be %s, not %s" % (key, ", ".join(LEVELS), value or "empty"))
    return value


def parse(text):
    """{"type"?, "code"?, "web"?, "helpers"?} from a brainstorm's header lines (those before the first `## ` heading).
    Raises BadMode on a value it does not know."""
    found = {}
    for line in (text or "").splitlines():
        if line.startswith("## "):
            break
        key, sep, value = line.partition(":")
        if not sep or value.strip().startswith("<"):  # no value, or the template's placeholder
            continue
        if key.strip() == "Type" and value.strip():
            found["type"] = _check("type", value)
        elif key.strip() == "Helpers" and value.strip():
            found["helpers"] = helpers_line(value)
        elif key.strip() == "Scouts":
            for word in value.split():
                kind, eq, lvl = word.partition("=")
                if not eq or kind.strip().lower() not in KINDS:
                    raise BadMode("Scouts: takes code=<level> and web=<level>, not %s" % word)
                found[kind.strip().lower()] = _check(kind.strip().lower(), lvl)
    return found


PICKABLE = tuple(n for n in HELPER_NAMES if n not in ("scout", "web"))  # the scouts follow the Scouts: levels
GROUP = dict({"architect": "consult", "designer": "consult", "po": "consult", "skeptic": "skeptic"},
             **{lens: "lens" for lens in LENSES})


def helpers_line(value):
    """The helpers a `Helpers:` line picks, in its order: `architect po skeptic lens=ux,security`, or `none`."""
    names = []
    for word in value.split():
        word = word.strip().lower()
        if word == "none":
            continue
        listed = word[len("lens="):].split(",") if word.startswith("lens=") else [word]
        for name in (n.strip() for n in listed if n.strip()):
            if name not in PICKABLE:
                raise BadMode("Helpers: takes %s (or lens=<lens>,<lens>, or none), not %s" % (", ".join(PICKABLE), name))
            if name not in names:
                names.append(name)
    return tuple(names)


def helpers_text(names):
    """The `Helpers:` line's value for these helpers: the consultants and the skeptic, then lens=..."""
    names = [n for n in PICKABLE if n in names]
    rest = [n for n in names if GROUP[n] != "lens"]
    lenses = [n for n in names if GROUP[n] == "lens"]
    return " ".join(rest + (["lens=" + ",".join(lenses)] if lenses else [])) or "none"


def over(names, caps):
    """The first group the helpers pick more of than its cap, as (group, picked, cap), or None."""
    for group in ("consult", "skeptic", "lens"):
        picked = sum(1 for n in names if GROUP[n] == group)
        if picked > caps.get(group, 0):
            return group, picked, caps.get(group, 0)
    return None


def read(plan_dir, state_dir, feature):
    """The run's brainstorm choice: the plan's brainstorm.md once the plan exists, else the one in the state
    folder, else {}."""
    for path in (Path(plan_dir) / feature / "brainstorm.md", Path(state_dir) / ("brainstorm-%s.md" % feature)):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        return parse(text)
    return {}


def level(kind, environ, filled, mode):
    """One scout level. FLOW_SCOUTS=off set by you wins, then the brainstorm's own `Scouts:` level, then its
    type's, then FLOW_SCOUTS=off filled by a profile (fast fills it), else normal."""
    off = environ.get("FLOW_SCOUTS", "on") == "off"
    if off and "FLOW_SCOUTS" not in filled:
        return "off"
    if mode.get(kind):
        return mode[kind]
    if mode.get("type"):
        return TYPES[mode["type"]][kind]
    return "off" if off else "normal"


def limits(profile, levels, kind):
    """{group: most helpers of that group in one brainstorm} for this profile, these levels and this type."""
    out = dict(LIMITS["careful" if profile == "careful" else "normal"])
    for group, lvl in (("scout", levels["code"]), ("web", levels["web"])):
        out[group] = LEVEL_LIMITS[group].get(lvl, out[group])
    for group in ("consult", "skeptic", "lens"):
        out[group] = TYPES.get(kind or "standard", {}).get(group, out[group])
    return out


def credit(text):
    """{"ideas": {helper: tags in Options}, "chosen": {helper: tags in the chosen option and the Chosen section}}.

    Each idea in the brainstorm ends with the helper it came from in brackets (`[architect]`, `[ux]`), so eval can
    say which helpers' ideas reached the pick. A markdown link `[text](url)` is not a tag."""
    sections, current, sub = {}, None, None
    for line in (text or "").splitlines():
        if line.startswith("## "):
            current, sub = line[3:].strip().lower(), None
            sections.setdefault(current, {"": []})
        elif line.startswith("### ") and current:
            sub = line[4:].strip()
            sections[current][sub] = []
        elif current:
            sections[current][sub or ""].append(line)
    chosen_text = "\n".join(sections.get("chosen", {}).get("", []))
    letter = re.match(r"^\W*([A-Z])\b", chosen_text.strip())
    ideas, chosen = {}, {}

    def count(into, lines):
        for name in TAG.findall("\n".join(lines)):
            into[name] = into.get(name, 0) + 1

    for sub, lines in sections.get("options", {}).items():
        count(ideas, lines)
        if letter and re.match(r"^%s[.)]\s" % letter.group(1), sub):
            count(chosen, lines)
    count(chosen, sections.get("chosen", {}).get("", []))
    return {"ideas": ideas, "chosen": chosen}
