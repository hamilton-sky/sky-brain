# Map: <feature>

## Destination

<One paragraph: what exists when this is done.>

**The bar.** <The single measurable check that proves the whole feature: the command and the
output it must print. The last ticket runs it.>

## How to work this

- See what is ready: `python3 scripts/flow-status.py <feature>`. Take the lowest numbered READY ticket.
- Claim: set `Status: claimed` in the ticket and save before starting.
- Resolve: write the result under `## Answer`, set `Status: resolved`, then add one line to
  Decisions so far below.
- See the graph: `python3 scripts/flow-status.py <feature> --mermaid` (coloured by status, drawn on demand).
- Commands live in `commands.md` (frozen). Lessons live in `learnings.md` (append only).
- Status lives only in the ticket files. This map never repeats it.

## Decisions so far

<One line per resolved ticket: `NN — the decision or finding, in a sentence`.>

## Open questions

- <things not known yet that may change later tickets>
