// A row of pill tabs that picks one view (the board's Today and All goals, a document's Read,
// Sections, Source and Split). Styles: `.views` and `.view` in board/review.css.
export function ViewSwitch<V extends string>(props: {
  label: string;
  views: readonly (readonly [V, string])[];
  value: V;
  onChange: (view: V) => void;
}) {
  return (
    <div className="views" role="tablist" aria-label={props.label}>
      {props.views.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="tab"
          className="view"
          aria-selected={props.value === v}
          onClick={() => props.onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
