// The brain book on its own page (/book, /book/<chapter>, D46): the same chapters the agents read
// with the MCP `book` tool, so the person sees what their agents are told. The contents carry
// "Your brain now", filled from the person's own memories and boards.
import { Alert, PageHeader, Skeleton } from "panel-frame-ui";
import { useEffect, useState } from "react";
import { api, type BookPage as Book } from "../api.ts";
import { Markdown } from "../docs/Markdown.tsx";
import { navigate } from "../router.ts";
import "./book.css";

export function BookPage({ chapter }: { chapter?: string }) {
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = chapter ?? "contents";

  useEffect(() => {
    let live = true;
    setError(null);
    api.book(chapter).then(
      (b) => live && setBook(b),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [chapter]);

  return (
    <>
      <PageHeader
        title="Book"
        description="How your agents are taught to use your brain: the same chapters they read."
      />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="book">
        <nav className="book-chapters" aria-label="Chapters">
          {(book?.chapters ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              className="book-chapter"
              aria-current={c.id === current ? "page" : undefined}
              onClick={() =>
                navigate(
                  c.id === "contents"
                    ? { page: "book" }
                    : { page: "book", chapter: c.id },
                )
              }
            >
              {c.title}
            </button>
          ))}
        </nav>
        <article className="book-text">
          {book && book.id === current ? (
            <Markdown source={book.markdown} />
          ) : (
            !error && <Skeleton className="loading" />
          )}
        </article>
      </div>
    </>
  );
}
