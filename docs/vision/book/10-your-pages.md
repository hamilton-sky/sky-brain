# 10. From shammai

> Example pages, to show what this chapter looks like. They are not real yet: in the product,
> every page here is written or approved by the person.

## Notes

**On chapter `board`** · added by shammai
In my brain, one GitHub repository is one project. Name a task after the change it makes, the
way its PR title would read.

**On tool `capture`** · proposed by `mcp/claude.ai/po`, approved by shammai on 24 Nov 2026
When shammai writes in Hebrew, capture in English and keep the Hebrew original in the body.
Reason given: "Search ranks English text better today; two sessions captured Hebrew-only and
could not find it later."

## Recipes

**ship-docs-pr: write a design and open it for review** · added by shammai
1. `search { q: "<topic>", kind: "decision" }`
2. `capture { kind: "decision", ... }` for each new decision
3. `propose_goal` "Review {topic} design" with one task: read the PR
4. `request_approval` for the goal

## Glossary

| Term | Means |
| --- | --- |
| PO | Product owner: the role that writes goals |
| Hat | One of shammai's roles (Parent, Engineer). Not built yet |
| Pathly | The earlier local tool sky-brain replaces |
