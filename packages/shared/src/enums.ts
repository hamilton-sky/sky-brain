// Value lists from docs/PLAN.md section 5 (Data model).

export const AUTHOR_KINDS = ["human", "agent"] as const;
export type AuthorKind = (typeof AUTHOR_KINDS)[number];

export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];
