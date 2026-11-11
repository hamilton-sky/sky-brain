// The error line and the submit and cancel buttons every small form on the page ends with.
export function FormFooter(props: {
  error: string | null;
  submitLabel: string;
  disabled: boolean;
  onCancel: () => void;
}) {
  return (
    <>
      {props.error && <p className="error">{props.error}</p>}
      <div className="row">
        <button className="button primary" disabled={props.disabled}>
          {props.submitLabel}
        </button>
        <button type="button" className="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}
