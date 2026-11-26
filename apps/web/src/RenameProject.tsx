// Renaming a project (people who are owners or editors). The slug stays, so links keep working.
import { TextField } from "panel-frame-ui";
import { useState } from "react";
import { FormFooter, useFormSubmit } from "./FormFooter.tsx";
import { api, type Project } from "./api.ts";

export function RenameProject(props: {
  project: Project;
  onDone: (p: Project | null) => void;
}) {
  const [name, setName] = useState(props.project.name);
  const { busy, error, submit } = useFormSubmit();
  const same = name.trim() === props.project.name;
  return (
    <form
      className="pf-card form"
      onSubmit={(e) =>
        submit(e, () =>
          api.renameProject(props.project.id, name).then(props.onDone),
        )
      }
    >
      <h2>Rename project</h2>
      <TextField
        label="Name"
        autoFocus
        required
        maxLength={120}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <FormFooter
        error={error}
        submitLabel="Rename"
        disabled={busy || !name.trim() || same}
        onCancel={() => props.onDone(null)}
      />
    </form>
  );
}
