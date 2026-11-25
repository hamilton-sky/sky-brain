# 2. Layer: About me

## What it is for

About me is who the person is: name, languages, values, health facts they chose to keep, how they
like to work and to be answered. It is the brain's **self**. Everything else is read in its light:
a decision in a Notebook means more when you know who made it and why.

## What is in it

Up to about 60 short entries, each a `fact` or a `rule` about the person ("Answers in Hebrew when I
write in Hebrew", "No meetings before 10"). There is exactly one About me per person. It never
fades. Later, entries can be tagged with a hat (Parent, Engineer): you then see the shared part
plus your hat's part.

## How to use it

- **Read it first** when you act for the person: it is always in the context packet (`claim_task`,
  `context`), so you rarely need to search it.
- **Trust it over other layers** for facts about the person. If a Notebook entry contradicts it,
  tell the person.
- **Never write it.** Only the person edits About me. If you learn something about them, capture it
  into the Inbox as a `fact` and say why it may belong in About me; the person moves it.

## Its APIs (generated)

- **search** · read-only · `q`, `layer: "core"` → About me entries with summaries.
- **context** · read-only · `q` → About me comes first in every packet.
No write tool: About me is people-only (hard rule 3).

## Recipe: answer "what do you know about me?"

1. `search { q: "<topic>", layer: "core" }`
2. Answer from approved entries only; name what is not there yet.
