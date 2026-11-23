// The error line and the submit and cancel buttons every small form on the page ends with, and
// the busy and error state behind them.
import { Alert, Button } from "panel-frame-ui";
import { useState, type FormEvent } from "react";

/** Busy and error state for a small form: `submit(e, run)` sends, and shows a failure. */
export function useFormSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent, run: () => Promise<void>) => {
    e.preventDefault();
    setBusy(true);
    run().catch((err: Error) => {
      setError(err.message);
      setBusy(false);
    });
  };
  return { busy, error, submit };
}

export function FormFooter(props: {
  error: string | null;
  submitLabel: string;
  disabled: boolean;
  onCancel: () => void;
}) {
  return (
    <>
      {props.error && <Alert tone="error">{props.error}</Alert>}
      <div className="row">
        <Button type="submit" disabled={props.disabled}>
          {props.submitLabel}
        </Button>
        <Button variant="secondary" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}
