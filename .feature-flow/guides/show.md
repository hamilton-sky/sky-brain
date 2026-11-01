# Show the ticket graph

Show the ticket graph for the feature you were given. The word `watch` means the run is in progress and the page should keep updating.

If no feature was given, list `plans/*/` and ask which one.

## Step 1: Write and open the page

Run `python3 scripts/flow-view.py <feature>`. Add `--watch` when the user said `watch`. It writes one HTML file, normally `.git/flow-<feature>.html`, and opens it in the default browser.

If the script is not installed, say so and point to `uvx feature-flow-cli install .` (or `python3 install.py <repo>` from a feature-flow clone). If no browser could be opened (a remote machine, for example), print the path and tell the user to open it. Set `FLOW_NO_OPEN=1` to never open one.

## Step 2: Summarise it in words

Run `python3 scripts/flow-status.py <feature>` and `--counts`, then write a few lines:

- how many tickets are resolved, in progress, ready and waiting
- which tickets are **ready now**
- the **longest chain of unfinished tickets**: that is the critical path, and it decides how soon the feature can finish
- what is blocking the acceptance ticket, if one is still open
- any ticket that was sent back (the page marks it with a badge)

## Step 3: Tell the user what the page does

- **Replay** plays the run back from git history: tickets turn green in the order they resolved, and a ticket sent back flashes red.
- Dashes flow along the edges into tickets that are ready to start. Ready tickets pulse, and a ticket being worked spins.
- Hover or click a ticket for its blockers, Done when, Answer, and the rounds it was sent back.
- **Now** returns to the current state. The Theme button switches light and dark. Space plays or pauses, the arrow keys step, `t` switches theme.

The page needs no server and no network. It is generated from the ticket files and the git history, so it is always read only.
