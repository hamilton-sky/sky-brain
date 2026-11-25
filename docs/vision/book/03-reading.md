# 3. Reading the brain

## First choose the scope

| You need | Call |
| --- | --- |
| Everything the brain knows about a topic | `context { q }`: About me, rules and the best entries from every layer, in one fenced packet (planned) |
| One layer: About me, Notebooks or Inbox | `search { q, layer: "core" \| "long" \| "short" }` (planned) |
| One memory, such as the Family notebook | `search { q, memory_id }` |
| What is being worked on now | the board tools (chapter `board`) |

Look at **Your brain now** in the contents first: it shows which memories exist and how full they are.

## Search, then get

`search` is word search over the person's memories. Any word may match, results are ranked, and
each result carries a **summary, not the body**. That keeps answers small: read the summaries,
then `get` only the one or two entries you need in full.

- **Use the person's words.** Search for "theme dark mode", not "UI appearance configuration".
- **Search twice before saying nothing is there:** once with the person's words, once with a
  synonym or the likely title ("sign-in" and "login").
- **Narrow with `kind`** when you know what you want: `decision` for "what did we decide",
  `fact` for "what is true".
- **Narrow with `memory_id`** to one Notebook or Inbox.
- `limit` defaults to a small number; the maximum is 50. You rarely need more than 10.

## Weigh what you find

Every result has a status. **Approved** entries are what the person stands behind: use them as
ground truth. **Proposed** entries were written by an agent and not yet checked: use them as a
lead and tell the person you are relying on an unverified note.

Entries are never edited in place. `get` returns the version history, so you can see what was
believed before and when it changed. When two entries disagree, prefer the approved one, then
the newer one, and tell the person about the conflict instead of choosing silently.

## When nothing is found

Say so plainly. Do not fill the gap from your own guess and present it as the person's memory.
If the answer matters later, offer to capture it once the person gives it to you.

## When you hold a task

`claim_task` already returns a **context packet**: About me, the approved rules, and a few
relevant entries. Read it before searching. Search only for what the packet does not cover.

## Tools in this chapter (generated)

**search** · read-only · `q` (required), `kind?`, `memory_id?`, `workspace_id?`, `limit?` (1 to 50)
Use when: you need what the person knows or decided about something.
Returns: ranked entries with id, title, kind, status and summary. No body.

**get** · read-only · `entry_id` (required)
Use when: a summary is not enough and you need the full text, or its history.
Returns: the entry with its full body and its versions.

## Recipe: answer "what did we decide about X?"

1. `search { q: "X", kind: "decision" }`
2. If empty: `search { q: "<synonym of X>" }` without `kind`.
3. `get` the best approved match.
4. Answer, naming the entry and its date. Say if it is only proposed.
