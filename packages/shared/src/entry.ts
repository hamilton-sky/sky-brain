// The wire `Entry` (spec.md Interfaces -> Wire types): snake_case, ISO date strings.
import type { AuthorKind, Kind, Source, Status } from "./enums.ts";

export interface Entry {
  id: string;
  seq: number;
  workspace_id: string;
  project_id: string | null;
  feature_id: string | null;
  kind: Kind;
  /** The effective status: `expired` once `expires_at` has passed for a proposed or open entry. */
  status: Status;
  title: string;
  body: string;
  author_kind: AuthorKind;
  author: string;
  on_behalf_of: string;
  source: Source;
  refs: string[];
  reply_to: string | null;
  supersedes: string | null;
  confidence: number | null;
  expires_at: string | null;
  allow_agent_answers: boolean;
  /** The quarantine pattern id while the effective status is `quarantined`, else null. */
  quarantined_because: string | null;
  created_at: string;
  updated_at: string;
}
