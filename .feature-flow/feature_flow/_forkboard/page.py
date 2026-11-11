"""The review page: one self contained HTML file for a review document, with diagrams people can edit.

render(doc, theme) turns a document (forkboard.doc, schema "bundle/1") into the page. The document carries
sections, options and a restricted markdown (paragraphs, lists, tables, code, mermaid diagrams, `code`, **bold**,
*em* and https links); the page escapes everything else. The look comes from a theme, a CSS file of colour and font
tokens in forkboard/themes/. Nothing is sent anywhere; the page loads its fonts from Google Fonts, and mermaid from
jsDelivr only for a diagram that is not a flowchart.
"""

import html
import json
import re
from pathlib import Path

from .graph import BOXES, COLOURS, flowchart

MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"
SUITS_LINE = re.compile(r"/\*\s*suits:\s*(.*?)\s*\*/")
FONT_LINE = re.compile(r"/\*\s*fonts:\s*(https://fonts\.googleapis\.com/\S+)\s*\*/")
HERE = Path(__file__).resolve().parent
THEMES = HERE / "themes"
DEFAULT_THEME = "route"


def asset(name):
    """One of the page's own files in forkboard/assets/, as text."""
    with open(str(HERE / "assets" / name), encoding="utf-8", newline="") as f:
        return f.read()


def themes():
    """The names of the themes there are."""
    return sorted(p.stem for p in THEMES.glob("*.css"))


def suits(name):
    """What a theme suits, from its `/* suits: ... */` line, or ""."""
    m = SUITS_LINE.search(theme_css(name) or "")
    return m.group(1).strip() if m else ""


def theme_css(name):
    """The CSS of a theme, or None when there is no such theme."""
    path = THEMES / (name + ".css")
    return path.read_text(encoding="utf-8") if name in themes() else None


def dots(attr, checked):
    """The colour picker: one round button per colour, then None."""
    swatch = '<button type="button" role="menuitemradio" aria-checked="%s" data-%s="%s" title="%s" aria-label="%s">%s</button>'
    return '<span class="dots">%s</span>' % "".join(
        swatch % (str(name == checked).lower(), attr, name, name.capitalize(), name.capitalize(),
                  '<i style="--c:%s"></i>' % hue if hue else '<i class="none"></i>')
        for name, hue, _ in COLOURS + (("", "", ""),)).replace('title=""', 'title="None"').replace('aria-label=""', 'aria-label="None"')


ARRANGE = (  # what the Arrange menu offers: layout, icon, name, what it suits
    ("LR", '<path d="M3 9h5M13 9h5"/><rect x="1" y="6" width="4" height="6"/><rect x="9" y="6" width="4" height="6"/>'
           '<rect x="18" y="6" width="5" height="6"/>', "Left to right", "steps that run in order"),
    ("TD", '<path d="M12 5v2M12 11v2"/><rect x="8" y="1" width="8" height="4"/><rect x="8" y="7" width="8" height="4"/>'
           '<rect x="8" y="13" width="8" height="4"/>', "Top to bottom", "layers, or a tall chain"),
    ("radial", '<circle cx="12" cy="9" r="3"/><path d="M12 6V3M12 12v3M9 9H5M15 9h4"/><circle cx="12" cy="2" r="1.5"/>'
               '<circle cx="12" cy="16" r="1.5"/><circle cx="3.5" cy="9" r="1.5"/><circle cx="20.5" cy="9" r="1.5"/>',
     "Radial", "one part many others call"),
    ("grid", '<rect x="2" y="2" width="8" height="6"/><rect x="14" y="2" width="8" height="6"/>'
             '<rect x="2" y="10" width="8" height="6"/><rect x="14" y="10" width="8" height="6"/>',
     "Grid", "a list of parts, compact"),
)

TOOLS = ('<span class="split"><button type="button" data-act="add">Add box</button>'
         '<button type="button" data-act="shapes" aria-haspopup="menu" aria-expanded="false" '
         'aria-label="Pick the kind and colour of box">&#9662;</button><span class="menu" role="menu" hidden>%s'
         '<span class="menu-head">Colour of new boxes</span>%s</span></span>'
         % ("".join('<button type="button" role="menuitem" data-shape="%s" data-name="%s"><svg viewBox="0 0 24 18" '
                    'aria-hidden="true">%s</svg><span><b>%s</b><small>%s</small></span></button>'
                    % (shape, name.lower(), icon, name, means) for shape, name, means, icon in BOXES), dots("next", ""))
         + '<span class="split"><button type="button" data-act="colour" aria-haspopup="menu" aria-expanded="false">'
           'Colour &#9662;</button><span class="menu" role="menu" hidden><span class="menu-head">Colour of the selected '
           'box</span>%s</span></span>' % dots("colour", "")
         + '<span class="split"><button type="button" data-act="arrange" aria-haspopup="menu" aria-expanded="false">'
           'Arrange &#9662;</button><span class="menu" role="menu" hidden><span class="menu-head">Lay the boxes out'
           '</span>%s</span></span>' % "".join(
               '<button type="button" role="menuitem" data-arrange="%s"><svg viewBox="0 0 24 18" aria-hidden="true">%s'
               '</svg><span><b>%s</b><small>%s</small></span></button>' % row for row in ARRANGE)
         + "".join('<button type="button" data-act="%s">%s</button>' % pair for pair in (
             ("rename", "Rename"), ("connect", "Connect"), ("delete", "Delete"), ("undo", "Undo"), ("redo", "Redo"),
             ("reset", "Reset"), ("copy", "Copy as mermaid"))))

# ---- markdown, the small part a review document uses ------------------------------------------------------

def inline(text):
    """Escaped text with `code`, **bold**, *em* and [links](https://...) turned into tags."""
    parts = re.split(r"(`[^`]+`)", text)
    out = []
    for part in parts:
        if part.startswith("`") and part.endswith("`") and len(part) > 1:
            out.append("<code>%s</code>" % html.escape(part[1:-1]))
            continue
        piece = html.escape(part, quote=False)
        piece = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)",
                       lambda m: '<a href="%s">%s</a>' % (html.escape(html.unescape(m.group(2))), m.group(1)), piece)
        piece = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", piece)
        piece = re.sub(r"(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])", r"<em>\1</em>", piece)
        out.append(piece)
    return "".join(out)


def blocks(lines, figures):
    """HTML for a run of markdown lines: paragraphs, lists, tables, fenced code and diagrams."""
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("```"):
            lang = stripped[3:].strip().lower()
            body = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            i += 1
            out.append(figure("\n".join(body), figures) if lang == "mermaid"
                       else "<pre><code>%s</code></pre>" % html.escape("\n".join(body)))
            continue
        if stripped.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            body = [r for r in rows if not all(re.fullmatch(r":?-{2,}:?", c or "-") for c in r)]
            head, rest = (body[0], body[1:]) if len(rows) > 1 and body is not rows else (None, body)
            table = "".join("<th>%s</th>" % inline(c) for c in head) if head else ""
            out.append('<div class="tbl"><table>%s<tbody>%s</tbody></table></div>' % (
                "<thead><tr>%s</tr></thead>" % table if table else "",
                "".join("<tr>%s</tr>" % "".join("<td>%s</td>" % inline(c) for c in r) for r in rest)))
            continue
        bullet = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", line)
        if bullet:
            tag = "ol" if bullet.group(2)[0].isdigit() else "ul"
            items = []
            while i < len(lines):
                m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", lines[i])
                if m:
                    items.append(m.group(3))
                elif lines[i].strip() and items and lines[i].startswith((" ", "\t")):
                    items[-1] += " " + lines[i].strip()
                else:
                    break
                i += 1
            out.append("<%s>%s</%s>" % (tag, "".join("<li>%s</li>" % inline(t) for t in items), tag))
            continue
        para = []
        while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith(("```", "|")) \
                and not re.match(r"^\s*([-*]|\d+\.)\s+", lines[i]):
            para.append(lines[i].strip())
            i += 1
        out.append("<p>%s</p>" % inline(" ".join(para)))
    return "\n".join(out)


# ---- diagrams -----------------------------------------------------------------------------------------------

def figure(text, figures):
    figures.append(text)
    k = len(figures)
    graph = flowchart(text)
    source_block = ('<details class="src"><summary>Mermaid source</summary><pre><code>%s</code></pre></details>'
                    % html.escape(text))
    if graph is None:
        return ('<figure class="dg" id="fig-%d"><div class="scroll"><pre class="mermaid">%s</pre></div>%s</figure>'
                % (k, html.escape(text), source_block))
    data = json.dumps(graph, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return ('<figure class="dg graph" id="fig-%d" data-fig="%d">'
            '<div class="tools">%s<input class="rename" type="text" hidden maxlength="80">'
            '<span class="edited" hidden>Edited</span></div>'
            '<p class="hint" aria-live="polite">Drag to move. Double-click to rename, Delete to remove, Connect to add an '
            'arrow, Ctrl+Z to undo. Edits stay in this browser; copy the mermaid to keep them.</p>'
            '<div class="scroll"><svg role="img" aria-label="Diagram %d"></svg></div>'
            '<script type="application/json" class="graph-data">%s</script>'
            '<script type="text/plain" class="graph-src">%s</script>%s</figure>'
            % (k, k, TOOLS, k, data, html.escape(text), source_block))


# ---- the page ------------------------------------------------------------------------------------------------

def slug(text, used):
    base = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "section"
    name, n = base, 2
    while name in used:
        name, n = "%s-%d" % (base, n), n + 1
    used.add(name)
    return name


def fences(markdown):
    """[mermaid source] of the diagrams in a run of markdown, found the way blocks() finds them."""
    lines, found, i = markdown.split("\n"), [], 0
    while i < len(lines):
        stripped = lines[i].strip()
        if stripped.startswith("```"):
            lang, body = stripped[3:].strip().lower(), []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            if lang == "mermaid":
                found.append("\n".join(body))
        i += 1
    return found


def diagrams(doc):
    """[(figure number, mermaid source, the title it sits under)], numbered in the page's order from 1."""
    found = [("", src) for src in fences(doc.get("intro") or "")]
    for section in doc.get("sections") or []:
        found += [(section.get("title") or "", src) for src in fences(section.get("markdown") or "")]
        for item in section.get("items") or []:
            found += [(item.get("title") or "", src) for src in fences(item.get("markdown") or "")]
    return [(n, src, title) for n, (title, src) in enumerate(found, 1)]


def palette_css():
    return "".join("g.node.c-%s .shape{fill:color-mix(in srgb,%s 16%%,var(--box));stroke:%s}\n" % (name, hue, hue)
                   for name, hue, _ in COLOURS)


def palette_js():
    return "\nvar PALETTE = %s;" % json.dumps({name: [hue, fill] for name, hue, fill in COLOURS})


# shared SVG effects a theme can point at: url(#fb-rough) makes lines look drawn by hand
FX = ('<svg class="fx" aria-hidden="true" focusable="false"><filter id="fb-rough" filterUnits="userSpaceOnUse" '
      'x="-4000" y="-4000" width="8000" height="8000"><feTurbulence type="fractalNoise" baseFrequency="0.03" '
      'numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter></svg>\n')

KINDS = {"chosen": "callout good", "rejected": "muted", "open": "callout", "callout": "callout"}


def ask_about(subjects):
    """A place the live layer turns into an "Ask Claude about" box with a pick of the section's subjects (its
    tickets, say); empty without subjects. Each item of a section is a subject of its own, without this."""
    subjects = [str(x) for x in subjects or [] if str(x).strip()]
    if not subjects:
        return ""
    data = json.dumps(subjects, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return '<div class="ask-about" hidden><script type="application/json">%s</script></div>' % data


def has_choices(doc):
    return any(section.get("choices") for section in doc.get("sections") or [])


def choices(items):
    """The choices of a section: buttons for one of several, boxes for some. They show the tool's value and stay
    disabled until the live layer finds people who can save; without it, people answer in the chat."""
    if not items:
        return ""
    out = []
    for choice in items:
        kind, key = choice.get("kind") or "one", str(choice["key"])
        value = choice.get("value")
        picked = set(str(v) for v in (value or [])) if kind == "some" else {str(value)} if value is not None else set()
        opts = []
        for o in choice["options"]:
            v, label, note = str(o["value"]), o.get("label") or str(o["value"]), o.get("note") or ""
            title = ' title="%s"' % html.escape(note) if note else ""
            if kind == "some":
                opts.append('<label%s><input type="checkbox" value="%s"%s disabled> %s</label>' % (
                    title, html.escape(v), " checked" if v in picked else "", inline(label)))
            else:
                opts.append('<button type="button" data-value="%s" aria-pressed="%s"%s disabled>%s</button>' % (
                    html.escape(v), str(v in picked).lower(), title, inline(label)))
        top = choice.get("max")
        explain = [(o.get("label") or str(o["value"]), o["note"]) for o in choice["options"] if o.get("note")]
        out.append('<fieldset class="choice" data-key="%s" data-kind="%s"%s><legend>%s%s</legend>%s<div class="pick">%s</div>'
                   '%s%s</fieldset>' % (
                       html.escape(key), kind, ' data-max="%d"' % top if isinstance(top, int) else "",
                       inline(choice.get("label") or key),
                       ' <span class="most">up to %d</span>' % top if isinstance(top, int) and kind == "some" else "",
                       '<p class="about">%s</p>' % inline(choice["about"]) if choice.get("about") else "",
                       "".join(opts),
                       '<ul class="explain">%s</ul>' % "".join('<li><b>%s</b> %s</li>' % (inline(label), inline(note))
                                                               for label, note in explain) if explain else "",
                       '<p class="note">%s</p>' % inline(choice["note"]) if choice.get("note") else ""))
    return '<div class="choices">%s%s</div>' % ("".join(out), CHOICE_HINT)


CHOICE_HINT = '<p class="choice-hint">Reply ok in the chat to take these, or say what to change.</p>'


def has_choices_html(html_text):
    return 'class="choice"' in html_text


def stepped(steps, body):
    """The sections as HTML, grouped under their steps when the document has steps: each step is a tab, opened on the
    current one. A done step shows its summary and a Change button; the current step, when it has choices, an Approve
    button that saves its picks for the tool at once; a later step is greyed. Sections with no step come last."""
    if not steps:
        return "\n".join(h for _, h in body)
    current = next((n for n, s in enumerate(steps, 1) if s.get("state") == "current"), None)
    if current is None:
        current = max([n for n, s in enumerate(steps, 1) if s.get("state") == "done"] or [1])
    out = ['<div class="tabs" role="tablist" aria-label="Steps">%s</div>' % "".join(
        '<button type="button" role="tab" class="tab %s" id="tab-%d" aria-controls="step-%d" aria-selected="%s"%s>'
        '<span class="n">%d</span><b>%s</b>%s</button>' % (
            s.get("state") or "later", n, n, str(n == current).lower(), "" if n == current else ' tabindex="-1"', n,
            html.escape(s["name"]), '<span class="sum">%s</span>' % inline(s["summary"]) if s.get("summary") else "")
        for n, s in enumerate(steps, 1))]
    for n, s in enumerate(steps, 1):
        name, state = s["name"], s.get("state") or "later"
        inner = "\n".join(h for step, h in body if step == name).replace(CHOICE_HINT, "")  # the Approve row says it
        head = '<div class="step-head"><span class="n">%d</span><b>%s</b>%s%s</div>' % (
            n, html.escape(name), '<span class="sum">%s</span>' % inline(s["summary"]) if s.get("summary") else "",
            '<button type="button" class="change" data-change="%s" hidden>Change</button>' % html.escape(name)
            if state == "done" else "")
        approve = ""
        if state == "current" and has_choices_html(inner):
            approve = ('<div class="approve-row"><button type="button" class="approve" data-approve="%s" disabled>'
                       'Approve %s</button><span class="approve-hint">Reply ok in the chat to take these, or say what '
                       'to change.</span></div>' % (html.escape(name), html.escape(name)))
        if state == "later" and not inner:
            inner = '<p class="later-note">This step opens once the steps before it are approved.</p>'
        out.append('<section class="step %s" role="tabpanel" id="step-%d" aria-labelledby="tab-%d" data-step="%s"%s>'
                   '%s%s%s</section>' % (state, n, n, html.escape(name), "" if n == current else " hidden",
                                         head, inner, approve))
    out += [h for step, h in body if not step]
    return "\n".join(out)


def render(doc, css, theme_name, fragment=False, live=False):
    """The page for a document, in a theme (its CSS and name); fragment leaves out the doctype, html, head and body
    tags for a host that adds its own (an Artifact); live adds the layer a page published as an artifact uses."""
    lines = lambda text: (text or "").split("\n")
    ident = doc.get("id") or "review"
    kind_name = doc.get("kind") or "Review"
    figures, used = [], set()
    nav, body = [], []
    intro = blocks(lines(doc.get("intro")), figures)  # the intro's diagrams come first, as in the source
    for section in doc.get("sections") or []:
        heading, kind = section.get("title") or "", section.get("kind") or "text"
        sid = slug(heading, used)
        children = []
        sub_html = []
        for item in section.get("items") or []:
            sub, label, picked = item.get("title") or "", item.get("label") or "", bool(item.get("chosen"))
            cid = slug(sub, used)
            children.append('<li><a href="#%s"><span class="n">%s</span>%s</a></li>'
                            % (cid, html.escape(label) if label else "&middot;", inline(sub)))
            sub_html.append('<article class="opt%s" id="%s" data-about="%s"><h3>%s%s</h3>%s</article>' % (
                " chosen" if picked else "", cid, html.escape(sub), inline(sub),
                ' <span class="badge">chosen</span>' if picked else "", blocks(lines(item.get("markdown")), figures)))
        inner = blocks(lines(section.get("markdown")), figures)
        cls = KINDS.get(kind, "")
        if cls.startswith("callout"):
            inner = '<div class="%s">%s</div>' % (cls, inner)
        body.append((section.get("step") or "", '<section class="block%s" id="%s"><div class="lvl-head"><div class="eyebrow">%s</div><h2>%s</h2>'
                    '</div>%s%s%s%s</section>' % (" muted" if kind == "rejected" else "", sid,
                                              html.escape(ident), inline(heading), inner, ask_about(section.get("ask_about")),
                                              choices(section.get("choices") or []),
                                              '<div class="opts">%s</div>' % "".join(sub_html) if sub_html else "")))
        nav.append('<li><a href="#%s"><span class="n">%d</span>%s</a>%s</li>' % (
            sid, len(nav) + 1, inline(heading), '<ol class="sub">%s</ol>' % "".join(children) if children else ""))
    steps = doc.get("steps") or []
    body = stepped(steps, body)
    fonts = FONT_LINE.search(css)
    meta_html = "".join('<span><b>%s:</b> %s</span>' % (html.escape(k.capitalize()), inline(v))
                        for k, v in (doc.get("meta") or {}).items())
    needs_mermaid = any(flowchart(f) is None for f in figures)
    page_title = "%s: %s" % (kind_name, ident)
    head = ("<title>%s</title>\n<meta name=\"claude:viewport-fit-sides\" content=\"cover\">\n%s<style>\n%s\n%s\n</style>\n"
            % (html.escape(page_title),
               ('<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" '
                'href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="%s">\n'
                % html.escape(fonts.group(1)) if fonts else ""),
               asset("base.css") + palette_css() + (asset("steps.css") if steps or has_choices(doc) else "")
               + (asset("live.css") if live else ""), css))
    content = (
        '<div class="wrap" data-page="%s"%s>\n<nav class="route" aria-label="Sections">'
        '<div class="progress"><div class="bar"><i></i></div><div class="count">0 of %d sections read</div></div>'
        '<div class="stage">%s</div><ol>%s</ol>'
        '<div class="stage">View</div><div class="controls">'
        '<div class="seg" role="group" aria-label="Theme"><button type="button" data-theme-set="system">System</button>'
        '<button type="button" data-theme-set="light">Light</button><button type="button" data-theme-set="dark">Dark'
        '</button></div><label class="motion"><input type="checkbox" id="motion"> Animate the arrows</label></div>'
        '</nav>\n%s<main>\n<header class="hero"><div class="eyebrow">%s review &middot; style %s</div>'
        '<h1>%s</h1>%s<div class="meta">%s</div></header>\n%s\n</main>\n</div>\n%s<script>\n%s\n</script>\n'
        % (html.escape(ident), ' data-live="1"' if live else "", len(nav), html.escape(kind_name), "".join(nav), FX,
           html.escape(kind_name), html.escape(theme_name), inline(doc.get("title") or page_title),
           intro, meta_html, body,
           '<script src="%s"></script>\n' % MERMAID if needs_mermaid else "",
           palette_js() + asset("editor.js") + (asset("steps.js") if steps else "") + (asset("live.js") if live else "")))
    if fragment:
        return head + content
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" '
            'content="width=device-width, initial-scale=1, viewport-fit=cover">\n%s</head>\n<body>\n%s</body>\n</html>\n'
            % (head, content))
