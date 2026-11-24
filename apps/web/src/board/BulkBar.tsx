// The bar above a list of goals waiting for you: select all, then approve or reject the
// selection in one go. Held goals can be rejected in bulk but never approved in bulk.
import { Button } from "panel-frame-ui";
import { useEffect, useRef } from "react";
import type { Goal } from "../api.ts";
import { canBulkApprove } from "./columns.ts";

export function BulkBar(props: {
  /** The goals on screen that can be picked. */
  pool: Goal[];
  selected: ReadonlySet<string>;
  onSelect: (ids: Set<string>) => void;
  busy: boolean;
  onApprove: (goals: Goal[]) => void;
  onReject: (goals: Goal[]) => void;
}) {
  const chosen = props.pool.filter((g) => props.selected.has(g.id));
  const approvable = chosen.filter(canBulkApprove);
  const all = props.pool.length > 0 && chosen.length === props.pool.length;
  const some = chosen.length > 0 && !all;
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = some;
  }, [some]);
  if (props.pool.length === 0) return null;

  return (
    <div className="bulk" role="group" aria-label="Bulk review">
      <label className="bulk-all">
        <input
          ref={box}
          type="checkbox"
          checked={all}
          onChange={() =>
            props.onSelect(
              all ? new Set() : new Set(props.pool.map((g) => g.id)),
            )
          }
        />
        <span>
          {chosen.length > 0
            ? `${chosen.length} selected`
            : `Select all ${props.pool.length}`}
        </span>
      </label>
      {chosen.length > approvable.length && approvable.length > 0 && (
        <span className="muted small">Held goals are skipped on approve.</span>
      )}
      <span className="bulk-acts">
        <Button
          className="small-button"
          disabled={props.busy || approvable.length === 0}
          onClick={() => props.onApprove(approvable)}
        >
          Approve{approvable.length > 0 ? ` ${approvable.length}` : ""}
        </Button>
        <Button
          variant="danger"
          className="small-button"
          disabled={props.busy || chosen.length === 0}
          onClick={() => props.onReject(chosen)}
        >
          Reject{chosen.length > 0 ? ` ${chosen.length}` : ""}
        </Button>
      </span>
    </div>
  );
}
