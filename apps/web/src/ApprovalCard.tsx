// One approval request (D31, D39). The person decides item by item: tick what to approve, mark
// what to reject, leave the rest as it is. An entry they approve can be kept where the agent
// suggested or in another memory: About me, a Notebook, or left in the Inbox.
import { Alert, Badge, Button, Card, Select } from "panel-frame-ui";
import { useState } from "react";
import {
  ApiError,
  approvalsApi,
  type Approval,
  type ApprovalItem,
  type ApprovalTarget,
  type ItemDecision,
} from "./api.ts";

type Action = ItemDecision["action"];

const STATUS_TEXT: Record<Approval["status"], string> = {
  pending: "Waiting for you",
  approved: "Done",
  rejected: "Rejected",
  expired: "Expired: ask the agent again",
  superseded: "Something changed since it was asked: nothing was applied",
};

const OUTCOME: Record<NonNullable<ApprovalItem["outcome"]>, string> = {
  approved: "Approved",
  rejected: "Rejected",
  skipped: "Left as it was",
};

const LAYER_WORD: Record<ApprovalTarget["layer"], string> = {
  core: "About me",
  long: "Notebook",
  short: "Inbox",
};

/** The agent's id without the transport: `mcp/claude.ai/po` reads as `claude.ai/po`. */
const agentLabel = (id: string) => id.replace(/^mcp\//, "");

function minutesLeft(approval: Approval): number {
  return Math.max(
    0,
    Math.round((Date.parse(approval.expires_at) - Date.now()) / 60_000),
  );
}

/** Where an entry goes by default: the agent's suggestion, else where it already is. */
const defaultTarget = (item: ApprovalItem) =>
  item.save_to ?? item.memory_id ?? "";

function targetOptions(targets: ApprovalTarget[]) {
  return targets.map((t) => ({
    value: t.id,
    label: t.layer === "core" ? "About me" : t.name,
    description:
      t.layer === "core"
        ? "Who you are; only you write here"
        : t.layer === "long"
          ? "Notebook: what lasts"
          : "Inbox: stays here and fades",
  }));
}

function ItemRow(props: {
  item: ApprovalItem;
  pending: boolean;
  action: Action;
  onAction: (a: Action) => void;
  target: string;
  onTarget: (id: string) => void;
  targets: ApprovalTarget[];
}) {
  const { item, action } = props;
  const where = props.targets.find((t) => t.id === item.memory_id);
  return (
    <li className={`approval-item is-${props.pending ? action : "done"}`}>
      {props.pending ? (
        <input
          type="checkbox"
          className="approval-check"
          aria-label={`Approve "${item.title}"`}
          checked={action === "approve"}
          disabled={item.changed}
          onChange={(e) =>
            props.onAction(e.target.checked ? "approve" : "skip")
          }
        />
      ) : null}
      <div className="approval-item-main">
        <div className="approval-item-title">
          <Badge tone="neutral">
            {item.kind === "goal" ? "Goal" : "Memory"}
          </Badge>
          <span className="t">{item.title}</span>
          {where && <span className="muted">in {LAYER_WORD[where.layer]}</span>}
          {item.changed && (
            <Badge tone="warning">changed since it was asked</Badge>
          )}
          {item.outcome && (
            <Badge tone={item.outcome === "approved" ? "accent" : "neutral"}>
              {OUTCOME[item.outcome]}
            </Badge>
          )}
        </div>
        {props.pending &&
          action === "approve" &&
          item.kind === "entry" &&
          props.targets.length > 0 && (
            <Select
              className="approval-target"
              variant="compact"
              label="Save to"
              value={props.target}
              onValueChange={props.onTarget}
              options={targetOptions(props.targets)}
            />
          )}
        {props.pending && action === "reject" && (
          <p className="muted small">
            {item.kind === "goal"
              ? "The goal will be cancelled."
              : "The note will be rejected; agents stop seeing it."}
          </p>
        )}
      </div>
      {props.pending && !item.changed && (
        <Button
          variant="quiet"
          className="approval-reject-one"
          aria-pressed={action === "reject"}
          onClick={() =>
            props.onAction(action === "reject" ? "skip" : "reject")
          }
        >
          {action === "reject" ? "Undo reject" : "Reject"}
        </Button>
      )}
    </li>
  );
}

function summaryLabel(approve: number, reject: number): string {
  if (approve === 0 && reject === 0) return "Pick something";
  const parts = [];
  if (approve > 0) parts.push(`Approve ${approve}`);
  if (reject > 0) parts.push(`${approve > 0 ? "reject" : "Reject"} ${reject}`);
  return parts.join(", ");
}

export function ApprovalCard(props: {
  approval: Approval;
  onDecided: (a: Approval) => void;
}) {
  const { approval } = props;
  const pending = approval.status === "pending";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Everything that has not changed starts ticked; a changed item cannot be approved.
  const [actions, setActions] = useState<Record<string, Action>>(() =>
    Object.fromEntries(
      approval.items.map((i) => [i.id, i.changed ? "skip" : "approve"]),
    ),
  );
  const [targets, setTargets] = useState<Record<string, string>>(() =>
    Object.fromEntries(approval.items.map((i) => [i.id, defaultTarget(i)])),
  );
  const count = (a: Action) =>
    approval.items.filter((i) => actions[i.id] === a).length;
  const approveN = count("approve");
  const rejectN = count("reject");

  const send = (action: "approve" | "reject") => {
    setBusy(true);
    setError(null);
    const items: ItemDecision[] | undefined =
      action === "approve"
        ? approval.items.map((i) => {
            const a = actions[i.id] ?? "skip";
            const to = targets[i.id];
            return a === "approve" &&
              i.kind === "entry" &&
              to &&
              to !== i.memory_id
              ? { id: i.id, action: a, save_to: to }
              : { id: i.id, action: a };
          })
        : undefined;
    approvalsApi.decide(approval.id, action, items).then(
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

  const all = approval.items.length;
  const setAll = (on: boolean) =>
    setActions((prev) =>
      Object.fromEntries(
        approval.items.map((i) => [
          i.id,
          i.changed
            ? "skip"
            : on
              ? "approve"
              : prev[i.id] === "reject"
                ? "reject"
                : "skip",
        ]),
      ),
    );

  return (
    <Card className="approval">
      <div className="section-head">
        <h2>{approval.reason}</h2>
        <Badge tone={pending ? "accent" : "neutral"}>
          {STATUS_TEXT[approval.status]}
        </Badge>
      </div>
      <p className="muted">
        Asked by {agentLabel(approval.requested_by)}
        {pending && ` · expires in ${minutesLeft(approval)} min`}
      </p>
      {pending && all > 1 && (
        <label className="approval-all">
          <input
            type="checkbox"
            checked={
              approveN === approval.items.filter((i) => !i.changed).length
            }
            onChange={(e) => setAll(e.target.checked)}
          />
          Select all
        </label>
      )}
      <ul className="approval-items">
        {approval.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            pending={pending}
            action={actions[item.id] ?? "skip"}
            onAction={(a) => setActions((p) => ({ ...p, [item.id]: a }))}
            target={targets[item.id] ?? ""}
            onTarget={(id) => setTargets((p) => ({ ...p, [item.id]: id }))}
            targets={approval.targets}
          />
        ))}
      </ul>
      {error && <Alert tone="error">{error}</Alert>}
      {pending && (
        <div className="approval-actions">
          <Button
            disabled={busy || approveN + rejectN === 0}
            onClick={() => send("approve")}
          >
            {summaryLabel(approveN, rejectN)}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => send("reject")}
          >
            {all > 1 ? "Reject all" : "Reject"}
          </Button>
          {approveN + rejectN < all && (
            <span className="muted small">
              {all - approveN - rejectN} left as{" "}
              {all - approveN - rejectN === 1 ? "it is" : "they are"}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
