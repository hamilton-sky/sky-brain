"""The diagram model: mermaid flowcharts in and out, as {"dir", "nodes", "edges"} graphs the page lays out."""

import hashlib
import re

SHAPES = (("([", "])", "stadium"), ("[(", ")]", "cylinder"), ("((", "))", "circle"), ("{{", "}}", "hexagon"),
          ("[/", "/]", "rect"), ("[\\", "\\]", "rect"), ("[", "]", "rect"), ("(", ")", "round"), ("{", "}", "diamond"),
          (">", "]", "rect"))
NODE = re.compile(r'\s*([A-Za-z0-9_][\w-]*)\s*(\(\[.*?\]\)|\[\(.*?\)\]|\(\(.*?\)\)|\{\{.*?\}\}|\[/.*?/\]|\[\\.*?\\\]'
                  r'|\[.*?\]|\(.*?\)|\{.*?\}|>.*?\])?\s*')
LINK = re.compile(r'\s*(-->|---|-\.->|-\.-|==>|===|--o|--x|<-->)\s*(?:\|([^|]*)\|)?\s*')
BOXES = (  # what the Add box menu offers: shape, name, what it usually means, icon
    ("rect", "Box", "a step, a part or a service", '<rect x="2" y="3" width="20" height="12" rx="2"/>'),
    ("round", "Rounded box", "a screen or a softer step", '<rect x="2" y="3" width="20" height="12" rx="5"/>'),
    ("stadium", "Pill", "a person, or where it starts or ends", '<rect x="2" y="3" width="20" height="12" rx="6"/>'),
    ("diamond", "Decision", "a yes or no question", '<path d="M12 1L22 9L12 17L2 9Z"/>'),
    ("cylinder", "Database", "data that is stored", '<path d="M3 4v10c0 2 18 2 18 0V4"/><ellipse cx="12" cy="4" rx="9" ry="2"/>'),
    ("hexagon", "Hexagon", "a job or a preparation step", '<path d="M6 3h12l4 6l-4 6H6L2 9Z"/>'),
    ("circle", "Circle", "an event or a signal", '<circle cx="12" cy="9" r="7"/>'),
)
COLOURS = (  # the colours a box can take: name, hue (outline, and the tint of the fill), light fill for mermaid
    ("teal", "#0e7268", "#dcefec"), ("green", "#2f8a3e", "#e1f1e3"), ("olive", "#7a8a1c", "#eef1d9"),
    ("sky", "#0f86b8", "#ddf0f8"), ("blue", "#2f6fdb", "#e0eafb"), ("indigo", "#4a52c9", "#e4e5f8"),
    ("purple", "#7c4fe0", "#ece5fb"), ("pink", "#c23d72", "#f8e1ea"), ("red", "#c8402f", "#f9e2df"),
    ("orange", "#d0661a", "#fbe8da"), ("amber", "#b58100", "#f7eed6"), ("grey", "#6b7785", "#eceef1"),
)
TEXT_LINK = re.compile(r'\s*(?:--|==)\s+([^-=][^>]*?)\s+(-->|---|==>|===)\s*')
OPS = {"arrow": "-->", "open": "---", "dotted": "-.->", "thick": "==>"}
BRACKETS = {"rect": ("[", "]"), "round": ("(", ")"), "stadium": ("([", "])"), "diamond": ("{", "}"),
            "hexagon": ("{{", "}}"), "circle": ("((", "))"), "cylinder": ("[(", ")]")}


def label_of(token, ident):
    for opener, closer, shape in SHAPES:
        if token.startswith(opener) and token.endswith(closer):
            text = token[len(opener):len(token) - len(closer)].strip()
            if len(text) > 1 and text[0] == text[-1] == '"':
                text = text[1:-1]
            return text.replace("<br>", " ").replace("<br/>", " "), shape
    return ident, "rect"


def flowchart(text):
    """{"dir", "nodes", "edges"} for a mermaid flowchart the page can lay out and let people drag, else None."""
    lines = [l.strip() for l in text.splitlines() if l.strip() and not l.strip().startswith("%%")]
    if not lines:
        return None
    head = re.match(r"^(flowchart|graph)(?:\s+(LR|RL|TD|TB|BT))?\s*;?$", lines[0], re.I)
    if not head:
        return None
    nodes, edges = {}, []

    def node(match):
        ident, token = match.group(1), match.group(2)
        if token:
            label, shape = label_of(token, ident)
            nodes[ident] = {"id": ident, "label": label, "shape": shape}
        elif ident not in nodes:
            nodes[ident] = {"id": ident, "label": ident, "shape": "rect"}
        return ident

    colours, known = {}, {c[0] for c in COLOURS}
    for line in lines[1:]:
        line = line.rstrip(";")
        painted = re.match(r"^class\s+([\w,\s-]+?)\s+([\w-]+)$", line)
        if painted and painted.group(2) in known:
            colours.update((ident.strip(), painted.group(2)) for ident in painted.group(1).split(","))
        if re.match(r"^(classDef|class|style|linkStyle|click|subgraph|end|direction)\b", line):
            continue
        line = TEXT_LINK.sub(lambda m: " %s|%s| " % (m.group(2), m.group(1)), line)
        pos, prev = 0, None
        while pos < len(line):
            m = NODE.match(line, pos)
            if not m or m.end() == pos:
                return None
            ident = node(m)
            if prev is not None:
                edges.append({"from": prev[0], "to": ident, "label": prev[1], "style": prev[2]})
            pos = m.end()
            if pos >= len(line):
                break
            l = LINK.match(line, pos)
            if not l:
                return None
            op = l.group(1)
            prev = (ident, (l.group(2) or "").strip(), "dotted" if "." in op else "thick" if "=" in op else
                    "open" if op in ("---", "===") else "arrow")
            pos = l.end()
        else:
            if prev is not None and pos >= len(line) and line.endswith(("-->", "---", "==>")):
                return None
    if not nodes:
        return None
    for ident, colour in colours.items():
        if ident in nodes:
            nodes[ident]["colour"] = colour
    direction = (head.group(2) or "TD").upper()
    return {"dir": "LR" if direction in ("LR", "RL") else "TD", "nodes": list(nodes.values()), "edges": edges}


def fingerprint(source):
    return hashlib.sha256(source.strip().encode("utf-8")).hexdigest()[:16]


def lost(source):
    """What a rewrite of this mermaid block drops: the page keeps boxes, arrows, shapes and palette colours only."""
    keep = {c[0] for c in COLOURS}
    found = []
    for line in source.splitlines():
        word = line.strip().split(" ", 1)[0]
        if word in ("subgraph", "style", "linkStyle", "click") and word not in found:
            found.append(word)
        elif word == "classDef" and line.split()[1:2] and line.split()[1] not in keep and "classDef" not in found:
            found.append("classDef")
        elif line.strip().startswith("%%") and "comments" not in found:
            found.append("comments")
    return found


def mermaid(graph):
    """Mermaid flowchart text for a graph, with its colours as classDef and class lines (the page's Copy as mermaid)."""
    quote = lambda s: '"%s"' % s.replace('"', "#quot;")
    lines = ["flowchart %s" % graph.get("dir", "TD")]
    for n in graph["nodes"]:
        left, right = BRACKETS.get(n.get("shape"), BRACKETS["rect"])
        lines.append("  %s%s%s%s" % (n["id"], left, quote(n["label"]), right))
    for e in graph["edges"]:
        lines.append("  %s %s%s %s" % (e["from"], OPS.get(e.get("style"), OPS["arrow"]),
                                       "|%s|" % quote(e["label"]) if e.get("label") else "", e["to"]))
    fills = {name: (hue, fill) for name, hue, fill in COLOURS}
    for name in fills:
        ids = [n["id"] for n in graph["nodes"] if n.get("colour") == name]
        if ids:
            lines.append("  classDef %s fill:%s,stroke:%s" % (name, fills[name][1], fills[name][0]))
            lines.append("  class %s %s" % (",".join(ids), name))
    return "\n".join(lines)
