# 4. Writing to the brain

## capture

`capture` saves one thing into the Inbox. It lands as **proposed** and stays that way until the
person keeps it.

**Capture when:** the person says "remember this"; a decision was made; you learned something a
later session will need; the person told you something about themselves.
**Do not capture:** small talk, things already in the brain (search first), your own plans for
this chat, secrets (they are refused), or long text pasted from the web without saying so.

## Choose the kind

| kind | Use for | Needs |
| --- | --- | --- |
| `fact` | Something true: "The live site is sky-brain.vercel.app" | |
| `decision` | Something chosen, with why: "Host everything on Vercel, because..." | Say who decided |
| `hypothesis` | A guess worth testing: "Search misses Hebrew queries" | |
| `observation` | Something seen, with evidence: "CI failed 3 times on lint" | `refs`, at least one |
| `external` | Text from the web or an import | `source: web` or `import`; web text is quarantined |

## Write the summary for the next reader

The summary (up to 600 characters) is what `search` shows and, later, what is embedded for
meaning search. Write it so a session that knows nothing about today understands it:

- Bad: "Decided per discussion."
- Good: "shammai decided on 24 Nov 2026 that model-proposed book pages need approval at level 2,
  like rules, because every model reads the book as guidance."

Add up to 3 `questions` the entry answers ("Who can approve a book page?"). They make the entry
findable by the way people ask.

Use `refs` for links: URLs, `path@commit`, PR links, or other entry ids.

## Lessons at the end of a task

`report_task` with `outcome: done` takes up to 3 `lessons`. Each lands in the Inbox as proposed,
like a capture. Write a lesson only when it would change how the next task is done.

## Tools in this chapter (generated)

**capture** · writes · `kind`, `title` (≤200), `body` (markdown, ≤16 KB), `summary` (≤600)
required; `questions?` (≤3), `topic?` (rule, question, answer, lesson, note, artifact...),
`refs?`, `source?` (web, import), `memory_id?`, `workspace_id?`
Use when: something is worth remembering.
Returns: the new entry with its id and status `proposed`.
Pitfalls: an `observation` without `refs` is refused; `source: web` makes it quarantined.

## Recipe: keep a decision the person just made

1. `search { q: "<the topic>", kind: "decision" }`: is there an older decision?
2. `capture { kind: "decision", title, body: "what, why, who, when", summary, questions,
   refs: ["<older decision id, if any>"] }`
3. If the person wants it kept now: `request_approval { items: [{ kind: "entry", id }], reason }`
   and give them the link.
