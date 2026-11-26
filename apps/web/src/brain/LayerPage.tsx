// One layer of the brain on its own page (/brain/about-me, /brain/notebooks, /brain/inbox): what
// it is for, a search over it, and its entries, newest first. An entry opens as a document.
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from "panel-frame-ui";
import { useEffect, useState } from "react";
import { entriesApi, type EntrySummary } from "../api.ts";
import { navigate, type EntryLayer } from "../router.ts";
import { agentLabel, ago, PART_ABOUT, PART_NAMES } from "./brainData.ts";
import "./brain.css";

export function LayerPage({ layer }: { layer: EntryLayer }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<EntrySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = PART_NAMES[layer];

  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () => {
        entriesApi.list(layer, query.trim() || undefined).then(
          (r) => live && (setRows(r), setError(null)),
          (e: Error) => live && setError(e.message),
        );
      },
      query ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [layer, query]);

  const now = Date.now();
  return (
    <>
      <PageHeader title={name} description={PART_ABOUT[layer]} />
      <label className="bv-search layer-search">
        <span className="bv-sr">Search {name}</span>
        <input
          id="layer-search"
          type="search"
          placeholder={`Search ${name}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error && <Alert tone="error">{error}</Alert>}
      {rows === null ? (
        <Skeleton className="loading" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={query ? `Nothing matches “${query}”` : `${name} is empty`}
          description={
            layer === "core"
              ? "Facts and rules about you that you keep from the Inbox show up here."
              : "What agents and you save shows up here."
          }
        />
      ) : (
        <ul className="layer-list">
          {rows.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="bv-item"
                onClick={() => navigate({ page: "doc", entryId: e.id })}
              >
                <span>
                  {e.title}
                  <small>
                    {e.kind} ·{" "}
                    {e.author_kind === "agent" ? agentLabel(e.author) : "you"} ·{" "}
                    {ago(e.created_at, now)}
                  </small>
                  {e.summary && e.summary !== e.title && (
                    <small className="layer-summary">{e.summary}</small>
                  )}
                </span>
                <Badge tone={e.trust === "approved" ? "accent" : "neutral"}>
                  {e.trust}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
