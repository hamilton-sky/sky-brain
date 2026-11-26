// Approvals (D31): what agents asked the person to approve. An agent's request carries a link to
// /a/<id>; the person opens it here, signed in, sees exactly what will change, and decides item by item. The
// Approvals page lists every request still waiting, so many can be cleared in one visit.
import { Alert, EmptyState, Skeleton } from "panel-frame-ui";
import { useCallback, useEffect, useState } from "react";
import { approvalsApi, type Approval } from "./api.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";

const POLL_MS = 20_000;

/** The page an approval link opens: one request. */
export function ApprovalLink({ id }: { id: string }) {
  const [approval, setApproval] = useState<Approval | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    approvalsApi.get(id).then(setApproval, (e: Error) => setError(e.message));
  }, [id]);
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!approval) return <Skeleton className="loading" />;
  return (
    <>
      <ApprovalCard approval={approval} onDecided={setApproval} />
      {approval.status !== "pending" && (
        <p className="muted">
          You can go back to the chat; the agent will see the answer.
        </p>
      )}
    </>
  );
}

/** Every request still waiting, refreshed while the page is open. */
export function Approvals() {
  const [list, setList] = useState<Approval[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    approvalsApi.pending().then(
      (a) => {
        setList(a);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!list) {
    return error ? (
      <Alert tone="error">{error}</Alert>
    ) : (
      <Skeleton className="loading" />
    );
  }
  if (list.length === 0) {
    return (
      <EmptyState
        title="Nothing waiting"
        description="When an agent asks you to approve something, it shows up here."
      />
    );
  }
  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      {list.map((a) => (
        <ApprovalCard
          key={a.id}
          approval={a}
          onDecided={(done) =>
            setList((l) => l && l.map((x) => (x.id === done.id ? done : x)))
          }
        />
      ))}
    </>
  );
}
