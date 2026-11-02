// The board's one place for secret and quarantine handling (cloud-task-board spec.md Check
// order steps 10 and 11): goal create (ticket 04), add tasks (05) and report text (07).
import { detectInjection } from "../guards/quarantine.ts";
import { scanForSecrets } from "../guards/secrets.ts";
import { HttpError } from "../http/http-error.ts";

/** 422 `secret_detected` naming the field and the rule (never the value) when one holds a secret. */
export function refuseSecrets(fields: { name: string; value: string }[]): void {
  const hit = scanForSecrets(fields);
  if (hit) {
    throw new HttpError(
      422,
      "secret_detected",
      "The text holds what looks like a secret; nothing was stored.",
      { field: hit.field, rule: hit.rule },
    );
  }
}

/** The quarantine pattern the title or the body matches, or undefined. */
export function heldBecause(title: string, body: string): string | undefined {
  return detectInjection(title) ?? detectInjection(body);
}

/** `[withheld: <rule>]` when `text` holds a secret, else `text` itself. */
export function withholdSecrets(text: string): string {
  const hit = scanForSecrets([{ name: "text", value: text }]);
  return hit ? `[withheld: ${hit.rule}]` : text;
}
