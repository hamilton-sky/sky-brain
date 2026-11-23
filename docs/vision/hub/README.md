# Brain docs hub

`index.html` is one page with a tab per sky-brain design page. Open it in a browser
(GitHub shows HTML as source). The same hub is live at
https://claude.ai/artifact/PehQqu9bT9T67xKjVpsJgR.

| Tab | File | Live page |
| --- | --- | --- |
| Overview | `overview.html` | in the hub |
| Architecture (current proposal) | `architecture.html` | https://claude.ai/artifact/5RoEqKqNHcKiUB7cpj256a |
| Product spec | `../spec.html` | https://claude.ai/artifact/ANQuhNF4JqcERjY99EG6nw |
| pgvector on Nanogres | `pgvector.html` | https://claude.ai/artifact/JFxXFm224tTJNfahqoEgUj |
| Vision research | `vision.html` (summary) | https://claude.ai/artifact/GHqQhnKUHh1cWBq2crmACb (live doc) |
| Agents and board | `agents.html` (summary) | https://claude.ai/artifact/1Z5BxT77Pn9bSvf97BCQrc (live doc) |
| Human memory research | `../HUMAN-MEMORY.md` (not a tab yet) | https://claude.ai/artifact/XeikKAahzyCFfoRv8wdoRZ (live doc) |
| Memory schema (latest proposal) | `../schema/MEMORY-SCHEMA.md` (not a tab yet) | https://claude.ai/artifact/V3VicyoEWLRUchmTLwgT3v |

All pages were checked against the Architecture page on 15 Nov 2026. The two live docs
are edited in Claude Docs, so their tabs here are a summary and a link.

**Newer than the tabs (23 Nov).** The memory schema replaces the memory parts of the
Architecture, Product spec and Vision tabs: one About me (core) per person, many Inboxes,
Notebooks and Boards as containers, entries that never move, summaries written by agents and
embedded by the server, keyword search on the body, and sharing per memory instead of per
project. Where a tab says "extend the `entries` table with a `tier` column" or "share by
project", the schema wins. The tabs themselves are not redrawn yet.
