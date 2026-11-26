// The brain view's right panel for the picked part: what it is for, what waits for the person,
// the agents that work in it, and what it holds, with a search over that part only.
import { Button } from "panel-frame-ui";
import type { ReactNode } from "react";
import {
  PART_ABOUT,
  PART_NAMES,
  type Part,
  type PartData,
  type PartItem,
  type PartLink,
} from "./brainData.ts";

const CHEVRON = (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="bv-chevron">
    <path d="M6 3l5 5-5 5" />
  </svg>
);

function Agents({ data }: { data: PartData }): ReactNode {
  if (data.part === "core") {
    return (
      <p className="bv-note">
        Every connected agent reads About me first. None can write it: only you.
      </p>
    );
  }
  if (data.agents.length === 0) {
    return <p className="bv-note">No agent has written here yet.</p>;
  }
  return (
    <ul className="bv-agents">
      {data.agents.map((a) => (
        <li key={a.id} className={a.activeNow ? "live" : undefined}>
          <span className="bv-avatar" aria-hidden="true">
            {a.label.slice(0, 2).toUpperCase()}
          </span>
          <span>
            {a.label}
            <small>{a.does}</small>
            {a.activeNow && <em className="bv-live">working here now</em>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function BrainPanel(props: {
  data: PartData | null;
  /** Shown when nothing is picked yet. */
  intro: boolean;
  query: string;
  onQuery: (q: string) => void;
  /** Search results for the query, or null while there is none. */
  results: PartItem[] | null;
  linkOf: (item: PartItem) => PartLink | null;
  onLink: (link: PartLink | null) => void;
  onItem: (item: PartItem) => void;
  onOpen: (part: Part) => void;
  onReview: () => void;
}) {
  const d = props.data;
  if (!d) {
    return (
      <div className="bv-panel-body">
        <h3>
          {props.intro ? "Pick a part of the brain" : "Reading your brain…"}
        </h3>
        <p className="bv-about">
          Each part is one layer of your memory. Click a part, or its name below
          the brain, to see which agents work in it and what it holds. Click an
          item to go there.
        </p>
      </div>
    );
  }
  const items = props.results ?? d.items.slice(0, 8);
  const name = PART_NAMES[d.part];
  return (
    <div className="bv-panel-body" onPointerLeave={() => props.onLink(null)}>
      <h3>
        <i className={`bv-dot part-${d.part}`} aria-hidden="true" />
        {name}
      </h3>
      <p className="bv-about">{PART_ABOUT[d.part]}</p>
      {d.waiting > 0 && (
        <div className="bv-needs">
          <span>
            <strong>{d.waiting} waiting for you</strong>
            <small>Agents asked you to approve these</small>
          </span>
          <Button onClick={props.onReview}>Review</Button>
        </div>
      )}
      <div className="bv-label">Agents in this part</div>
      <Agents data={d} />
      <div className="bv-label">What it holds</div>
      <label className="bv-search">
        <span className="bv-sr">Search {name}</span>
        <input
          id="brain-search"
          type="search"
          placeholder={`Search ${name}`}
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
        />
      </label>
      {items.length === 0 ? (
        <p className="bv-note">
          {props.query
            ? `Nothing in ${name} matches “${props.query}”.`
            : `${name} is empty.`}
        </p>
      ) : (
        <ul className="bv-items">
          {items.map((it) => {
            const link = props.linkOf(it);
            return (
              <li key={it.id}>
                <button
                  type="button"
                  className="bv-item"
                  onClick={() => props.onItem(it)}
                  onPointerEnter={() => props.onLink(link)}
                  onFocus={() => props.onLink(link)}
                >
                  <span>
                    {it.title}
                    <small>{it.meta}</small>
                    {link && (
                      <small
                        className={`bv-link part-${link.from === d.part ? link.to : link.from}`}
                      >
                        ↔ {link.label}
                      </small>
                    )}
                  </span>
                  {CHEVRON}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Button variant="secondary" onClick={() => props.onOpen(d.part)}>
        Open {d.part === "work" ? "the Board" : name}
      </Button>
    </div>
  );
}
