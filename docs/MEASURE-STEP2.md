# Measuring the thin loop (two weeks after step 2)

The assessment's step 5: for two weeks of real sky-brain and Pathly work, measure two things.
They answer risk 1 (will the person keep up with review?) and risk 2 (does memory make agents
better?). Write the numbers into a dated file under `bench/results/` at the end.

## 1. Are review cards really cleared?

There is no Digest page yet, so a "card" today is one agent-written entry waiting for the
person: trust `proposed` or `quarantined` in an Inbox. Cleared means approved, rejected or
revised by the person. The audit log has every step (`entry.capture`, `entry.approve`,
`entry.reject`, `entry.revise`).

Run weekly against the production database (read-only role is enough):

```sql
-- Cards created and cleared per week, per workspace.
with created as (
  select workspace_id, date_trunc('week', created_at) as week, count(*) as created
  from entries
  where author_kind = 'agent'
  group by 1, 2
), cleared as (
  select workspace_id, date_trunc('week', at) as week, count(distinct target_id) as cleared
  from audit_log
  where action in ('entry.approve', 'entry.reject', 'entry.revise')
  group by 1, 2
)
select c.workspace_id, c.week, c.created, coalesce(d.cleared, 0) as cleared
from created c left join cleared d using (workspace_id, week)
order by c.week;

-- Still waiting, and how old the oldest is.
select count(*) as waiting, min(created_at) as oldest
from entries
where author_kind = 'agent' and trust in ('proposed', 'quarantined');
```

**Pass:** at least 70% of cards cleared within 7 days, and the waiting pile does not grow
week on week. The plan caps the Digest at 10 cards a day; if agents write more than about
70 a week, the cap or the lesson rules need tightening before step 3.

## 2. Do agents answer "why" questions better?

Use the step 0 benchmark (`bench/questions.jsonl`, the `why` questions) and the real work:

1. **Before.** On day 0, start a fresh agent session with only the repo (no sky-brain tools).
   Ask it 10 `why` questions from the benchmark. Score each: 2 right with the reason, 1 partly,
   0 wrong or "I don't know". Note the minutes it spent reading files.
2. **During.** Work as usual: claim tasks through `claim_task` (the packet comes with them),
   send `lessons` on `report_task`, approve or reject them, and `capture` decisions as they are
   made.
3. **After.** On day 14, a fresh session with the sky-brain MCP connector: ask the same 10
   questions plus 5 new `why` questions about decisions made during the two weeks. Score the
   same way.

**Pass:** the score on the 5 new questions is at least 7 of 10 with memory, and clearly above
what the repo alone gives. If memory does not beat the repo on the new questions, the lesson
and capture habits are the problem, not search, and step 3 waits.

Also count, from the audit log, how many `claim` replies carried a non-empty Relevant section,
and read five packets by hand: were they on the task?
