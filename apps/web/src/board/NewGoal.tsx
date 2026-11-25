// A person adds a goal by hand; it starts as a draft like any agent's proposal.
import { TextField } from "panel-frame-ui";
import { useState } from "react";
import { api } from "../api.ts";
import { FormFooter, useFormSubmit } from "../FormFooter.tsx";

export function NewGoal(props: {
  projectId: string;
  onDone: (created: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const { busy, error, submit } = useFormSubmit();
  return (
    <form
      className="pf-card form"
      onSubmit={(e) =>
        submit(e, () =>
          api
            .createGoal(props.projectId, title, body)
            .then(() => props.onDone(true)),
        )
      }
    >
      <TextField
        label="Title"
        autoFocus
        required
        maxLength={200}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="pf-field">
        <span className="pf-field-label">What done looks like</span>
        <textarea
          className="pf-input"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <p className="muted small">
        It starts as a draft. Add tasks with Claude, then approve it here.
      </p>
      <FormFooter
        error={error}
        submitLabel="Create draft"
        disabled={busy || !title.trim()}
        onCancel={() => props.onDone(false)}
      />
    </form>
  );
}
