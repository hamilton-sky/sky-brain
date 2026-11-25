// Renders parsed markdown (markdown.ts) as React elements: text is always text, never HTML.
import { Fragment, type ReactNode } from "react";
import "./markdown.css";
import { type Inline, parseMarkdown } from "./markdown.ts";

function inline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "code":
        return <code key={i}>{n.v}</code>;
      case "strong":
        return <strong key={i}>{inline(n.c)}</strong>;
      case "em":
        return <em key={i}>{inline(n.c)}</em>;
      case "del":
        return <del key={i}>{inline(n.c)}</del>;
      case "link":
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {inline(n.c)}
          </a>
        );
    }
  });
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="md">
      {parseMarkdown(source).map((b, i) => {
        switch (b.t) {
          case "h": {
            const H = `h${b.level + 1}` as "h2" | "h3" | "h4" | "h5";
            return <H key={i}>{inline(b.c)}</H>;
          }
          case "p":
            return <p key={i}>{inline(b.c)}</p>;
          case "quote":
            return <blockquote key={i}>{inline(b.c)}</blockquote>;
          case "code":
            return (
              <pre key={i}>
                <code>{b.v}</code>
              </pre>
            );
          case "hr":
            return <hr key={i} />;
          case "ul":
          case "ol": {
            const L = b.t;
            return (
              <L key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </L>
            );
          }
        }
      })}
    </div>
  );
}
