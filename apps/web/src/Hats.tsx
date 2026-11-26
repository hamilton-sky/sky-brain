// Hats on the agents page (D30, D42): the self-aspects of your brain (Parent, Engineer,
// Friend). An agent wears one for a session, or always wears the one its app is bound to; a hat
// only narrows what the agent sees.
import { Alert, Button, Card, TextField } from "panel-frame-ui";
import { useState } from "react";
import { FormFooter, useFormSubmit } from "./FormFooter.tsx";
import { api, type Hat } from "./api.ts";

const EXAMPLES: { slug: string; name: string; description: string }[] = [
  {
    slug: "family",
    name: "Family",
    description: "Home, the kids, family plans.",
  },
  { slug: "work", name: "Work", description: "The job, the team, projects." },
  {
    slug: "friends",
    name: "Friends",
    description: "Friends and plans with them.",
  },
  { slug: "health", name: "Health", description: "Health, sleep, sport." },
];

const toSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function HatsCard(props: { hats: Hat[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<unknown>) =>
    p.then(props.onChange, (e: Error) => setError(e.message));
  const unused = EXAMPLES.filter(
    (x) => !props.hats.some((h) => h.slug === x.slug),
  );
  return (
    <Card>
      <div className="section-head">
        <h2>Hats</h2>
        {!adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            New hat
          </Button>
        )}
      </div>
      <p className="muted">
        A hat is one side of you, like parent or engineer. An agent picks the
        hat that fits the chat, or asks you, and then sees only that side plus
        what is true everywhere. A hat never lets an agent see more.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      {adding && (
        <NewHat
          onDone={(created) => {
            setAdding(false);
            if (created) props.onChange();
          }}
        />
      )}
      {props.hats.length === 0 && (
        <p className="muted">No hats yet. Your agents see your whole brain.</p>
      )}
      {props.hats.map((h) => (
        <div className="row" key={h.id}>
          <span className="row">
            <strong>{h.name}</strong>
            <span className="muted small">{h.description || h.slug}</span>
          </span>
          <Button
            variant="danger"
            className="small-button"
            onClick={() => void run(api.deleteHat(h.id))}
          >
            Delete
          </Button>
        </div>
      ))}
      {unused.length > 0 && (
        <div className="row">
          <span className="muted small">Quick add:</span>
          {unused.map((x) => (
            <Button
              key={x.slug}
              variant="quiet"
              onClick={() =>
                void run(api.createHat(x.slug, x.name, x.description))
              }
            >
              {x.name}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}

function NewHat(props: { onDone: (created: boolean) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const { busy, error, submit } = useFormSubmit();
  const slug = toSlug(name);
  return (
    <form
      className="form"
      onSubmit={(e) =>
        submit(e, () =>
          api.createHat(slug, name, description).then(() => props.onDone(true)),
        )
      }
    >
      <TextField
        label="Name"
        autoFocus
        required
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        label="What this side of you is about"
        maxLength={600}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <FormFooter
        error={error}
        submitLabel="Create"
        disabled={busy || !slug}
        onCancel={() => props.onDone(false)}
      />
    </form>
  );
}
