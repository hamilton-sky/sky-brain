# 4. Layer: Inbox

## What it is for

The Inbox is where new things land: your captures, lessons from tasks, imports. It is the brain's
**recent memory**: days to weeks, unsorted, unchecked. Items fade unless the person uses or keeps
them, so the Inbox stays small.

## What is in it

Proposed entries from agents and people, and quarantined text from the web (hidden from you until
the person releases it). A person can have several Inboxes (one per hat, later).

## How to use it

- **This is the only layer you write to.** `capture` always lands here, as *proposed*.
- **Search it for what is recent:** "what came in this week", "what did the last session note".
  Results get a recency boost.
- **Write for the next reader.** The summary (≤600 characters) is what search shows. Name who,
  what, when and why. Add up to 3 questions it answers.
- **Choose the kind:** `fact`, `decision` (say who decided), `hypothesis`, `observation` (needs
  `refs`), `external` (with `source: web` or `import`; web text is quarantined).
- **Search before you capture** so you do not write a duplicate; link the older entry in `refs`.
- **Never capture secrets** (refused) or small talk.

## Its APIs (generated)

- **capture** · writes · `kind`, `title` (≤200), `body` (≤16 KB), `summary` (≤600); `questions?` (≤3),
  `topic?`, `refs?`, `source?`, `memory_id?` → the new entry, status `proposed`.
- **search** · read-only · `q`, `layer: "short"` (planned) → recent items first.
- **report_task** `lessons` (≤3, with outcome done) also land here.

## Recipe: keep a decision the person just made

1. `search { q: "<topic>", kind: "decision" }` for an older one.
2. `capture { kind: "decision", title, body: "what, why, who, when", summary, refs: [<older id>] }`
3. If the person wants it kept now: `request_approval { items: [{ kind: "entry", id }], reason }`.
