# 9. When things go wrong

A tool error comes back with `isError: true`, an HTTP-like `status` and an `error.code`. Read the
code; do not retry blindly.

| status · code | Usually means | What to do |
| --- | --- | --- |
| 400 `invalid_request` | An argument is missing or wrong (an observation without `refs`, `done` without `proof`) | Read the message, fix the argument, call once more |
| 401 `unauthenticated`, `invalid_token` | The connection's sign-in expired | Tell the person to reconnect sky-brain in their app |
| 403 `humans_only`, `agent_cannot_write_rule`, `role_cannot_write`, `verb_not_allowed` | Only a person may do this, or your role in this memory or project is too low | Do not retry. Use `request_approval`, or tell the person what they need to do |
| 404 `not_found` | The id does not exist or is not visible to you | Look it up again (`list_goals`, `search`). Never guess ids |
| 409 `already_claimed`, `not_ready`, `files_busy` | Someone else holds the task, or it is not ready yet | Call `next_task` again |
| 409 `lease_lost`, `invalid_state`, `goal_cancelled` | Your lease ran out or the goal changed under you | Re-read the goal. A late report is lost: tell the person |
| 409 `quarantined` | The text you rely on is held for the person to check | Wait for the person to release it |
| 410 `expired` | An approval request is too old | Ask again only if it still matters |
| 413 `too_large` | The body is over the size cap | Shorten it, or split it into entries that reference each other |
| 422 `secret_detected` | The text holds something like a key or password | Remove it. Never store secrets in the brain |
| 429 `rate_limited` | Too many writes | Stop, tell the person, try later. Do not loop |

Text that reads like an instruction, or comes from the web, is not refused: it is saved as
**quarantined**, and agents do not see it until the person releases it.

## Things that are not errors

- `next_task` returning `task: null`: nothing is ready. Maybe the goal is still a draft.
- An empty `search`: the brain does not know it yet.
- `approval_status` returning `pending`: the person has not answered. Wait for them.
