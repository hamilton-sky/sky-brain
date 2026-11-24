// Who may sign in (D29, replacing D17's product-organization rule). The whole rule is `mayEnter`,
// so a later gate changes this function only.
//
// Perminister itself decides whether it signs a person in to sky-brain at all: with the app
// client's registration policy at "Public registration" any active account with a verified email
// gets a code, and a person disabled for the product does not. sky-brain then checks the two
// things it relies on, from the signed ID token: an email, and that Perminister has verified it.

/** True only for an account with an email that Perminister says is verified. */
export function mayEnter(who: {
  email: string | null | undefined;
  emailVerified: boolean | null | undefined;
}): boolean {
  return (
    typeof who.email === "string" &&
    who.email !== "" &&
    who.emailVerified === true
  );
}
