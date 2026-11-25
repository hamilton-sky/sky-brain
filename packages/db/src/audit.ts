// The only way the code touches audit_log: one insert. There is no update or delete path.
import type { DbOrTx } from "./client.ts";
import { auditLog } from "./schema.ts";

export interface AuditRow {
  workspaceId: string;
  /** `human:<user_id>` or `agent:<agent_id>`. */
  actor: string;
  action: string;
  targetId: string | null;
  /** Ids and states only: never a title, a body or a ref. */
  details: Record<string, unknown>;
}

export async function writeAudit(tx: DbOrTx, row: AuditRow): Promise<void> {
  await tx.insert(auditLog).values(row);
}
