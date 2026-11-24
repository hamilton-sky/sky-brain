// Approvals (D31): what agents asked the person to approve. An agent's request carries a link to
// /a/<id>; the person opens it here, signed in, sees exactly what will change, and decides. The
// Approvals page lists every request still waiting, so many can be cleared in one visit.
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
} from "panel-frame-ui";
import { useCallback, useEffect, useState } from "react";
import { ApiError, approvalsApi, type Approval } from "./api.ts";

const POLL_MS = 20_000;

const STATUS_TEXT: Record<Approval["status"], string> = {
  pending: "Waiting for you",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired: ask the agent again",
  superseded: "Something changed since it was asked: nothing was applied",
};

/** The agent's id without the transport: `mcp/claude.ai/po` reads as `claude.ai/po`. */
const agentLabel = (id: string) => id.replace(/^mcp\//, "");

function minutesLeft(approval: Approval): number {
  return Math.max(
    0,
    Math.round((Date.parse(approval.expires_at) - Date.now()) / 60_000),
  );
}

function ApprovalCard(props: {
  approval: Approval;
  onDecided: (a: Approval) => void;
}) {
  const { approval } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = approval.items.some((i) => i.changed);

  const decide = (action: "approve" | "reject") => {
    setBusy(true);
    setError(null);
    approvalsApi.decide(approval.id, action).then(
      (a) => {
        setBusy(false);
        props.onDecided(a);
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
        // The server closed it (expired, superseded): show the new state.
        if (e instanceof ApiError && (e.status === 409 || e.status === 410)) {
          approvalsApi.get(approval.id).then(props.onDecided, () => {});
        }
      },
    );
  };

  return (
    <Card className="approval">
      <div className="section-head">
        <h2>{approval.reason}</h2>
        <Badge tone={approval.status === "pending" ? "accent" : "neutral"}>
          {STATUS_TEXT[approval.status]}
        </Badge>
      </div>
      <p className="muted">
        Asked by {agentLabel(approval.requested_by)}
        {approval.status === "pending" &&
          ` · expires in ${minutesLeft(approval)} min`}
      </p>
      <ul className="approval-items">
        {approval.items.map((item) => (
          <li key={item.id}>
            <Badge tone="neutral">
              {item.kind === "goal" ? "Goal" : "Memory"}
            </Badge>{" "}
            <span>{item.title}</span>{" "}
            <span className="muted">({item.state})</span>
            {item.changed && (
              <Badge tone="warning">changed since it was asked</Badge>
            )}
          </li>
        ))}
      </ul>
      {error && <Alert tone="error">{error}</Alert>}
      {approval.status === "pending" && (
        <div className="approval-actions">
          <Button disabled={busy || changed} onClick={() => decide("approve")}>
            Approve{" "}
            {approval.items.length > 1 ? `all ${approval.items.length}` : ""}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => decide("reject")}
          >
            Reject
          </Button>
        </div>
      )}
    </Card>
  );
}

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
