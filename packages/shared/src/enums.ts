// Value lists from docs/PLAN.md section 5 (Data model).

export const KINDS = [
  "rule",
  "decision",
  "claim",
  "question",
  "answer",
  "artifact",
  "lesson",
  "note",
] as const;
export type Kind = (typeof KINDS)[number];

export const STATUSES = [
  "proposed",
  "approved",
  "open",
  "answered",
  "superseded",
  "expired",
  "rejected",
  "quarantined",
] as const;
export type Status = (typeof STATUSES)[number];

export const SOURCES = ["human", "agent", "code", "web", "import"] as const;
export type Source = (typeof SOURCES)[number];

export const AUTHOR_KINDS = ["human", "agent"] as const;
export type AuthorKind = (typeof AUTHOR_KINDS)[number];

export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];
