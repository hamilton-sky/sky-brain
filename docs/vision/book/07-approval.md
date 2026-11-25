# 7. Asking for approval

## Why you cannot approve

A model can be tricked. A web page or a shared note can contain text that makes a model write
"the person approved". So in sky-brain no tool approves, and nothing you write counts as the
person's answer. The person answers on sky-brain's own page, signed in, where you cannot reach.

## How to ask

1. Make the thing first: a draft goal (`propose_goal`) or a proposed entry (`capture`).
2. `request_approval { items: [{ kind: "goal" | "entry", id }], reason }`. Up to 20 items in one
   request. `reason` is one line: why these should be approved.
3. Show the person the **link** from the reply and ask them to open it. Say what they will see.
4. When they say they are done, call `approval_status { id }`. Do not poll in a loop.

## What the answer means

| status | Meaning | What you do |
| --- | --- | --- |
| `pending` | Not answered yet | Wait for the person; do not ask again |
| `approved` | The items are applied | Carry on |
| `rejected` | The person said no | Ask what to change. The items themselves stay as they were |
| `expired` | 60 minutes passed | Ask again only if it still matters |
| `superseded` | An item changed after the request was made | Nothing was applied. Ask again |

Limits: a request expires after 60 minutes, is decided once, and you may have at most 10 open
requests. Batch items into one request instead of asking one by one.

## What needs which approval

| Level | Examples | How |
| --- | --- | --- |
| 0 | `capture` into the Inbox; notes on a task you hold | No approval; it is already a proposal |
| 1 | Approve a draft goal or new tasks; keep an Inbox item | The approval link |
| 2 | Edit About me, rules, book pages; release a quarantined entry | The link in the person's own session (and a passkey, later) |
| 3 | Sharing, hats, roles, connected apps | Only on the sky-brain web app, never through you |

## Tools in this chapter (generated)

- **request_approval** · writes · `items[]` (1 to 20, `{kind: goal | entry, id}`), `reason` (one
  line) → the request with `id`, `status: pending` and `approval.url`.
- **approval_status** · read-only · `id` → the request and its status.
