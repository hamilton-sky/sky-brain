# The brain book: first draft

The text a connected model reads, for the tools sky-brain has today (main, plus `attach_document`
from PR #31). The design is in [../BOOK.md](../BOOK.md).

| File | What `book` / `book_read` returns |
| --- | --- |
| `00-contents.md` | `book`: the contents, as built for one caller |
| `01-start-here.md` ... `08-when-things-go-wrong.md` | `book_read { id: "<chapter>" }` |
| `09-your-pages.md` | the person's pages (examples only) |

Sections marked **(generated)** are built from the tool registry when the book is served; they are
written out here so the draft reads as the model will see it. Values in `{braces}` in the contents are
filled per caller. Everything else is the built-in prose that would move to
`apps/server/src/book/chapters/`.

`book.html` renders this draft with a searchable contents and a mock of the Book settings page
(live at https://claude.ai/artifact/R17CXKKuHiUM1gq7fsTdDd). It embeds the chapter files; rebuild it
when they change.
