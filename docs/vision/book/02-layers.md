# 2. The layers of the brain

A brain holds **memories**, and each memory is one of four layers. The layer belongs to the
memory: an entry never moves between layers. Moving knowledge from one layer to another is the
person's choice.

| Layer | Name the person sees | How many | What it holds | Who writes | How long | How you reach it |
| --- | --- | --- | --- | --- | --- | --- |
| core | **About me** | exactly 1 | Who the person is: name, values, languages, how they like to work | The person only | Always | In the `claim_task` context packet; `search` |
| long | **Notebooks** | many | Knowledge that lasts: facts, decisions, lessons the person kept | The person approves; you propose | Until it stops being true | `search`, then `get` |
| short | **Inbox** | many | New, unsorted things: your captures, lessons, imports | Anyone; yours land as proposed | Fades unless used or kept | `search`; you write here with `capture` |
| working | **Board** | one per project | Goals and tasks being worked on now | Agents and people, per task | Cleared when the goal closes | The board tools (chapter `board`) |

## What this means for you

- **You never choose a layer.** `capture` writes into the Inbox (the default one, or the Inbox
  you name with `memory_id`). The person keeps what matters into a Notebook.
- **You never write About me.** If you learn something about the person ("prefers Hebrew
  answers"), capture it as a `fact` in the Inbox and say why. The person decides if it belongs
  in About me.
- **Do not copy a memory into another.** If a Notebook entry already says it, link to it in
  `refs` instead of capturing it again.
- **Words the person uses:** About me, Notebook, Inbox, Board. Use these words with the person,
  not core, long, short or working.

## Tools in this chapter (generated)

**list_memories** · read-only · `workspace_id?`
Use when: you need the id of a specific Notebook or Inbox, to search in it or capture into it.
Returns: each memory with its id, name and layer.

## Recipe: capture into a specific Inbox

1. `list_memories` and pick the Inbox by name (for example "Family").
2. `capture { ..., memory_id: "<that inbox>" }`.
