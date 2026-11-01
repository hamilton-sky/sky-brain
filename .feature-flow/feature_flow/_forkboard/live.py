"""The live page: published as an artifact that saves itself, people keep their own versions and ask questions.

The page (index.html) stays fixed; what people do lands in state.json beside it, which the page saves with the
artifact's own publish. Each person saves their own version of a diagram, keyed by their id; the original is the
document's diagram; asks are questions for the session, which answers them and publishes again. A Change button on a
done step is an ask with its "step". Picks are the last thing anyone picked on each of the document's choices.

    state.json = {"feature", "round",
                  "figures": {"<n>": {"title", "source", "original": graph,
                                      "versions": {"<person id>": {"graph", "pos", "at", "via"}}}},
                  "asks": [{"by", "at", "figure", "version", "text", "answer", "step"?}],
                  "picks": {"<choice key>": {"by", "at", "value"}}}

The n-th figure is the n-th mermaid diagram in the document, counted from 1, as on the page. "feature" is the
document's id (the name is kept so pages published before forkboard still load). "source" is a fingerprint of the
diagram the page was built from, so a tool that writes a version back can see that its source changed since.
"""

import json

from .graph import fingerprint, flowchart, mermaid
from .page import diagrams


def state(doc, old=None):
    """The state for the document as it is now, keeping the versions and asks people saved in the old one."""
    old = old if isinstance(old, dict) else {}
    figures = {}
    for n, source, title in diagrams(doc):
        graph = flowchart(source)
        if graph is None:
            continue
        kept = (old.get("figures") or {}).get(str(n)) or {}
        figures[str(n)] = {"title": title, "source": fingerprint(source), "original": graph,
                           "versions": kept.get("versions") or {}}
    return {"feature": doc.get("id") or "review", "round": int(old.get("round") or 0) + 1, "figures": figures,
            "asks": old.get("asks") if isinstance(old.get("asks"), list) else [],
            "picks": old.get("picks") if isinstance(old.get("picks"), dict) else {}}


def picks(st):
    """{choice key: the value last picked}, from what people picked on the page."""
    out = {}
    for key, pick in (st.get("picks") or {}).items():
        if isinstance(pick, dict) and "value" in pick:
            out[str(key)] = pick["value"]
    return out


def asks(st):
    """What the people on the page asked and nobody answered yet, as text for the session."""
    lines = []
    for i, ask in enumerate(st.get("asks") or [], 1):
        if ask.get("answer"):
            continue
        fig = str(ask.get("figure") or "")
        where = fig and (st.get("figures") or {}).get(fig)
        lines.append("ask %d from %s at %s%s%s:" % (i, ask.get("by") or "someone", ask.get("at") or "?",
                                                      " about figure %s (%s)" % (fig, where.get("title", "")) if where else "",
                                                      " to change the step %s" % ask["step"] if ask.get("step") else ""))
        lines.append("  " + str(ask.get("text") or "").replace("\n", "\n  "))
        version = where and ask.get("version") and where["versions"].get(ask["version"])
        if version:
            lines.append("  their version of the figure (%s):" % ", ".join(version.get("via") or ["by hand"]))
            lines.append("    " + mermaid(version["graph"]).replace("\n", "\n    "))
    return "\n".join(lines) if lines else "no open asks"


def answer(st, number, text):
    items = st.get("asks") or []
    if not 1 <= number <= len(items):
        raise ValueError("no ask %d: there are %d" % (number, len(items)))
    items[number - 1]["answer"] = text
    return st


def version(st, figure, name):
    """(the graph of that version of a figure, the figure's source fingerprint); name is original or a person id."""
    fig = (st.get("figures") or {}).get(str(figure))
    if not fig:
        raise ValueError("no figure %s in the page's state: figures %s" % (figure, ", ".join(sorted(st.get("figures") or {})) or "none"))
    graph = fig["original"] if name == "original" else (fig["versions"].get(name) or {}).get("graph")
    if graph is None:
        raise ValueError("figure %s has no version %s: it has original%s" % (
            figure, name, "".join(", " + v for v in sorted(fig["versions"]))))
    return graph, fig.get("source")


def load(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def dump(st):
    return json.dumps(st, ensure_ascii=False, indent=1) + "\n"
