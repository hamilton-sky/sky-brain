"""The review document (schema "bundle/1"): what a tool hands Forkboard to make a page of.

    {"schema": "bundle/1",
     "id": "csv",                      # names the page, its sections' eyebrow and its saved state
     "kind": "Brainstorm",             # what sort of review: the page title is "<kind>: <id>"
     "title": "Brainstorm: csv",       # the heading; empty means the page title
     "meta": {"picked by": "person"},  # shown under the heading
     "intro": "markdown",
     "sections": [{"title": "Options", "kind": "text|chosen|rejected|open|callout", "markdown": "...",
                   "items": [{"title": "A. Stream it", "label": "A", "chosen": false, "markdown": "..."}]}]}

Two parts are optional, and a page without them looks as before:

     "steps": [{"name": "Setup", "state": "done|current|later", "summary": "type learn, scouts web=deep"}],
     a section's "ask_about": ["01 Export button"]   # subjects people can ask the tool about, one at a time
     a section's "step": "Setup"     # the step it belongs to: a done step folds into its summary and a Change button
     a section's "choices": [{"key": "type", "label": "Type", "kind": "one|some", "max": 2, "about": "what it sets",
                              "options": [{"value": "learn", "label": "Learn", "note": "new to the domain"}],
                              "value": "learn"}]   # one: a string; some: a list. What people pick lands in the
                                                   # page's state (live.py), and the tool reads it back.
                                                   # Each option's note is shown under the choice, so people
                                                   # see what each one means. With steps, the page shows them as
                                                   # tabs, and a pick waits for its step's Approve button.

The markdown is the restricted kind page.blocks() renders. Forkboard never reads or writes the tool's own files:
the tool turns them into this document, and writes back what people did itself.
"""

from . import SCHEMA

KINDS = ("text", "chosen", "rejected", "open", "callout")
STATES = ("done", "current", "later")
CHOICE_KINDS = ("one", "some")


def check(doc):
    """The document, or ValueError naming what is wrong with it."""
    if not isinstance(doc, dict):
        raise ValueError("a review document is a JSON object")
    schema = str(doc.get("schema") or "")
    if schema.split(".")[0] != SCHEMA.split(".")[0]:
        raise ValueError("this forkboard reads %s documents, not %s" % (SCHEMA, schema or "ones with no schema"))
    if not isinstance(doc.get("sections", []), list) or not isinstance(doc.get("meta", {}), dict):
        raise ValueError("sections must be a list and meta an object")
    for section in doc.get("sections") or []:
        if not isinstance(section, dict) or section.get("kind", "text") not in KINDS:
            raise ValueError("each section is an object whose kind is one of %s" % ", ".join(KINDS))
        if not isinstance(section.get("items", []), list) or not all(isinstance(i, dict) for i in section.get("items") or []):
            raise ValueError("a section's items must be a list of objects")
        for choice in section.get("choices") or []:
            check_choice(choice)
        about = section.get("ask_about", [])
        if not isinstance(about, list) or not all(isinstance(x, str) for x in about):
            raise ValueError("a section's ask_about must be a list of strings")
    steps = doc.get("steps") or []
    if not isinstance(steps, list) or not all(isinstance(s, dict) and s.get("name") and s.get("state", "later") in STATES
                                              for s in steps):
        raise ValueError("steps must be a list of objects with a name and a state of %s" % ", ".join(STATES))
    names = [s["name"] for s in steps]
    if len(set(names)) != len(names):
        raise ValueError("two steps share a name")
    for section in doc.get("sections") or []:
        if section.get("step") and section["step"] not in names:
            raise ValueError("the section %s names the step %s, which the steps do not have" % (
                section.get("title") or "?", section["step"]))
    return doc


def check_choice(choice):
    if not isinstance(choice, dict) or not choice.get("key") or choice.get("kind", "one") not in CHOICE_KINDS:
        raise ValueError("each choice is an object with a key and a kind of %s" % ", ".join(CHOICE_KINDS))
    options = choice.get("options")
    if not isinstance(options, list) or not options or not all(isinstance(o, dict) and "value" in o for o in options):
        raise ValueError("the choice %s needs options, each an object with a value" % choice["key"])
    values = [str(o["value"]) for o in options]
    value = choice.get("value")
    if choice.get("kind", "one") == "one":
        if value is not None and str(value) not in values:
            raise ValueError("the choice %s has the value %s, which is not one of its options" % (choice["key"], value))
    else:
        if value is not None and (not isinstance(value, list) or not all(str(v) in values for v in value)):
            raise ValueError("the choice %s takes a list of its options as its value" % choice["key"])
        top = choice.get("max")
        if top is not None and (not isinstance(top, int) or top < 0 or len(value or []) > top):
            raise ValueError("the choice %s picks more than its max" % choice["key"])
