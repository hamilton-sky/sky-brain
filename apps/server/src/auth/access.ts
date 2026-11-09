// Who may sign in (spec.md Decisions -> Who may sign in). The whole rule is `mayEnter`, so a
// later gate (an allowlist, a Perminister role) changes this function only.

/** The Perminister product whose organizations let a person into sky-brain. */
export const PERMINISTER_PRODUCT_ID = "sky-brain";

/**
 * True only for an account with an email that Perminister lists an organization for this product
 * for. A pending sky-brain invite alone never lets anyone in.
 */
export function mayEnter(who: {
  email: string | null | undefined;
  productIds: string[];
}): boolean {
  return (
    typeof who.email === "string" &&
    who.email !== "" &&
    who.productIds.includes(PERMINISTER_PRODUCT_ID)
  );
}

/** The `productId`s of the exchange's `organizations[]`, read from an untyped profile. */
export function productIdsOf(profile: unknown): string[] {
  if (typeof profile !== "object" || profile === null) return [];
  const organizations = (profile as { organizations?: unknown }).organizations;
  if (!Array.isArray(organizations)) return [];
  return organizations.flatMap((org: unknown) => {
    if (typeof org !== "object" || org === null) return [];
    const productId = (org as { productId?: unknown }).productId;
    return typeof productId === "string" ? [productId] : [];
  });
}
