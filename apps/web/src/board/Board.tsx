// One project's board, built for fast review: "Today" is a digest of up to ten goals waiting
// for you, and "All goals" is the card board (Needs you, Running, Waiting to start, Done).
// Approve and reject work on one goal or many; only a person can do either, so they live here.
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  Skeleton,
} from "panel-frame-ui";
import { useCallback, useEffect, useState } from "react";
import { api, type Goal, type Project } from "../api.ts";
import { type BulkAction, describeBulk, runBulk } from "./bulk.ts";
import { BulkBar } from "./BulkBar.tsx";
import { canReject, type Column, columnOf, COLUMNS } from "./columns.ts";
import { Digest } from "./Digest.tsx";
import { GoalPanel } from "./GoalPanel.tsx";
import { GoalTile } from "./GoalTile.tsx";
import { NewGoal } from "./NewGoal.tsx";
import "./board.css";

const REFRESH_MS = 15_000;
const VIEW_KEY = "sky-brain.board-view";
type View = "today" | "board";

function rememberedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "board" ? "board" : "today";
  } catch {
    return "today";
  }
}

export function Board({ project }: { project: Project }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<View>(rememberedView);
  const [tab, setTab] = useState<Column>("needs");
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<Goal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(() => {
    api.goals(project.id).then(
      (g) => {
        setGoals(g);
        setNow(new Date());
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [project.id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const pickView = (v: View) => {
    setView(v);
    setSelected(new Set());
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private windows may refuse storage; the view still switches.
    }
  };

  const bulk = (action: BulkAction, list: Goal[]) => {
    if (list.length === 0) return;
    setBusy(true);
    setNotice(null);
    void runBulk(list, (id) => api.goalAction(id, action)).then((r) => {
      setBusy(false);
      setNotice({ ok: r.failed.length === 0, text: describeBulk(action, r) });
      setSelected(new Set());
      load();
    });
  };

  const open = goals?.find((g) => g.id === openId) ?? null;
  const visible = (goals ?? []).filter((g) => columnOf(g) !== null);
  const needs = visible.filter((g) => columnOf(g) === "needs");
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  return (
    <section className="board">
      <div className="section-head">
        <div className="views" role="tablist" aria-label="View">
          {(
            [
              [
                "today",
                `Today${needs.length ? ` (${Math.min(needs.length, 10)})` : ""}`,
              ],
              ["board", "All goals"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              className="view"
              aria-selected={view === v}
              onClick={() => pickView(v)}
            >
              {label}
            </button>
          ))}
        </div>
        {!adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            New goal
          </Button>
        )}
      </div>
      {adding && (
        <NewGoal
          projectId={project.id}
          onDone={(created) => {
            setAdding(false);
            if (created) load();
          }}
        />
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {notice && (
        <Alert tone={notice.ok ? "success" : "warning"}>{notice.text}</Alert>
      )}
      {goals === null ? (
        <Skeleton className="loading" />
      ) : (
        <div className={open ? "layout open" : "layout"}>
          <div className="layout-main">
            {view === "today" ? (
              <Digest
                goals={goals}
                now={now}
                selected={selected}
                onSelect={setSelected}
                busy={busy}
                openId={openId}
                onOpen={setOpenId}
                onApprove={(l) => bulk("approve", l)}
                onReject={setRejecting}
              />
            ) : visible.length === 0 ? (
              <EmptyState
                title="No goals yet"
                description="Ask Claude to propose one with the sky-brain connector, or add one here."
              />
            ) : (
              <>
                <BulkBar
                  pool={needs}
                  selected={selected}
                  onSelect={setSelected}
                  busy={busy}
                  onApprove={(l) => bulk("approve", l)}
                  onReject={setRejecting}
                />
                <div className="tabs" role="tablist" aria-label="Columns">
                  {COLUMNS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="tab"
                      className="tab"
                      aria-selected={tab === c.id}
                      onClick={() => setTab(c.id)}
                    >
                      {c.label}
                      <span className="c">
                        {visible.filter((g) => columnOf(g) === c.id).length}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="cols">
                  {COLUMNS.map((c) => {
                    const list = visible.filter((g) => columnOf(g) === c.id);
                    return (
                      <section
                        key={c.id}
                        className={`col ${c.id}${tab === c.id ? " show" : ""}`}
                        aria-label={c.label}
                      >
                        <div className="col-h">
                          <span className="dot" />
                          <span>{c.label}</span>
                          <span className="count">{list.length}</span>
                        </div>
                        {list.map((g) => (
                          <GoalTile
                            key={g.id}
                            goal={g}
                            now={now}
                            open={openId === g.id}
                            onOpen={() =>
                              setOpenId(openId === g.id ? null : g.id)
                            }
                            {...(canReject(g)
                              ? {
                                  picked: selected.has(g.id),
                                  onPick: (on: boolean) => toggle(g.id, on),
                                }
                              : {})}
                          />
                        ))}
                        {list.length === 0 && (
                          <div className="empty">Nothing here</div>
                        )}
                      </section>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          {open && (
            <GoalPanel
              goal={open}
              now={now}
              onClose={() => setOpenId(null)}
              onChanged={load}
              onReject={setRejecting}
            />
          )}
        </div>
      )}
      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={
          rejecting?.length === 1
            ? `Reject "${rejecting[0]!.title}"?`
            : `Reject ${rejecting?.length ?? 0} goals?`
        }
        description="Rejected goals are cancelled: their tasks stop and agents will not pick them up again."
        confirmLabel="Reject"
        cancelLabel="Keep"
        onConfirm={() => {
          const list = rejecting ?? [];
          setRejecting(null);
          if (list.some((g) => g.id === openId)) setOpenId(null);
          bulk("cancel", list);
        }}
      />
    </section>
  );
}
