# 8. Recipes

Whole sequences for common jobs. Each step is one call. Each recipe is also served as an MCP
prompt with the same name, where the client supports prompts.

## session-start: start a session in this brain
1. `book`
2. `context { q: "<the person's request>" }`, or open the layer chapter that fits
3. Follow the recipe it finds, or read the chapter.

## next-task: do the next ready task
1. `next_task { project_id }` (stop if `null`)
2. `claim_task { task_id }`, keep `claim_seq`, read the context packet
3. `renew_task` every ~8 minutes while working
4. `report_task { outcome: "done", proof, lessons? }`, or `failed` with `reason`

## answer-from-memory: answer "what do I know / what did we decide about X"
1. `search { q: "X" }` (add `kind: "decision"` for decisions)
2. `search` again with a synonym if empty
3. `get` the best approved entry
4. Answer, citing the entry and its status

## save-decision: keep a decision the person just made
1. `search { q: "<topic>", kind: "decision" }` for an older one
2. `capture { kind: "decision", ..., refs: [<older id>] }`
3. `request_approval { items: [{ kind: "entry", id }] }` if the person wants it kept now

## plan-goal: turn a request into a goal with tasks
1. `list_projects`, then `list_goals { project_id }` to avoid a duplicate
2. `propose_goal { project_id, title, body }`
3. `add_tasks { goal_id, tasks }` with `depends_on` and `files`
4. `request_approval { items: [{ kind: "goal", id }] }`, show the link

## goal-document: write a document for a goal
1. `capture { kind: "fact" or "decision", title, body, summary }` (the summary shows on the card)
2. `attach_document { goal_id, entry_id }`

## cannot-do: a task you hold cannot be done
1. `report_task { outcome: "failed", reason }`: never `release_task`, which puts it back as ready
2. Only then `add_tasks` for what is missing, on the same goal

## check-inbox: go through the Inbox and find contradictions
1. `search { layer: "short" }` with no `q`: the Inbox's newest entries
2. For each entry, `context { q: "<its topic>" }` to see About me, the Notebooks and the rules
3. Where a proposed entry disagrees with an approved one, `capture { kind: "observation", refs: [both ids] }`
4. Tell the person which side is approved

## end-of-task-lessons: close a task and teach the next one
1. `report_task { outcome: "done", proof, lessons: [≤3, each with a summary] }`
2. If a lesson is about how to use sky-brain itself: `propose_book_page { kind: "note", ... }`
   (when that tool exists)
