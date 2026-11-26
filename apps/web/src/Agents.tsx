// The agents page (D25 part 1): name the roles your agents play, and choose which role each
// connected app acts as. Everything an agent writes then carries that role as its byline.
import {
  Alert,
  Badge,
  Button,
  Card,
  Select,
  Skeleton,
  TextField,
} from "panel-frame-ui";
import { useCallback, useEffect, useState } from "react";
import { FormFooter, useFormSubmit } from "./FormFooter.tsx";
import { HatsCard } from "./Hats.tsx";
import { api, type AgentProfile, type ConnectedApp, type Hat } from "./api.ts";

const TEMPLATES: { slug: string; name: string; kind: AgentProfile["kind"] }[] =
  [
    { slug: "po", name: "Product owner", kind: "worker" },
    { slug: "doer", name: "Doer", kind: "worker" },
    { slug: "reviewer", name: "Reviewer", kind: "worker" },
    { slug: "librarian", name: "Librarian", kind: "steward" },
  ];

/** The Select values for "no role" and "no hat": ids are uuids, so they never collide. */
const GUEST = "guest";
const ANY_HAT = "any";

function appLabel(app: ConnectedApp): string {
  if (app.name) return app.name;
  try {
    return new URL(app.client_id).host;
  } catch {
    return app.client_id;
  }
}

export function Agents() {
  const [data, setData] = useState<{
    profiles: AgentProfile[];
    apps: ConnectedApp[];
    hats: Hat[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.agents(), api.hats()]).then(
      ([agents, hats]) => setData({ ...agents, hats }),
      (e: Error) => setError(e.message),
    );
  }, []);
  useEffect(load, [load]);

  const run = (p: Promise<unknown>) =>
    p.then(load, (e: Error) => setError(e.message));

  if (!data) {
    return error ? (
      <Alert tone="error">{error}</Alert>
    ) : (
      <Skeleton className="loading" />
    );
  }
  const unused = TEMPLATES.filter(
    (t) => !data.profiles.some((p) => p.slug === t.slug),
  );

  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <div className="section-head">
          <h2>Roles</h2>
          {!adding && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              New role
            </Button>
          )}
        </div>
        <p className="muted">
          A role names what an agent does for you. Agents still only propose;
          you approve.
        </p>
        {adding && (
          <NewProfile
            onDone={(created) => {
              setAdding(false);
              if (created) load();
            }}
          />
        )}
        {data.profiles.length === 0 && (
          <p className="muted">No roles yet. Every app acts as a Guest.</p>
        )}
        {data.profiles.map((p) => (
          <div className="row" key={p.id}>
            <span className="row">
              <strong>{p.display_name}</strong>
              <span className="muted small">{p.slug}</span>
              <Badge tone={p.kind === "steward" ? "accent" : "neutral"}>
                {p.kind}
              </Badge>
            </span>
            <Button
              variant="danger"
              className="small-button"
              onClick={() => void run(api.deleteAgentProfile(p.id))}
            >
              Delete
            </Button>
          </div>
        ))}
        {unused.length > 0 && (
          <div className="row">
            <span className="muted small">Quick add:</span>
            {unused.map((t) => (
              <Button
                key={t.slug}
                variant="quiet"
                onClick={() =>
                  void run(api.createAgentProfile(t.slug, t.name, t.kind))
                }
              >
                {t.name}
              </Button>
            ))}
          </div>
        )}
      </Card>
      <HatsCard hats={data.hats} onChange={load} />
      <Card>
        <h2>Connected apps</h2>
        {data.apps.length === 0 && (
          <p className="muted">
            No app is connected yet. Add sky-brain as a connector in claude.ai
            or Claude Code first.
          </p>
        )}
        {data.apps.map((app) => (
          <div key={app.client_id} className="form">
            <Select
              label={appLabel(app)}
              value={app.profile_id ?? GUEST}
              onValueChange={(id) =>
                void run(api.bindApp(app.client_id, id === GUEST ? null : id))
              }
              options={[
                { value: GUEST, label: "Guest", description: "No role yet" },
                ...data.profiles.map((p) => ({
                  value: p.id,
                  label: p.display_name,
                  description: p.kind === "steward" ? "Steward" : "Worker",
                })),
              ]}
            />
            {data.hats.length > 0 && (
              <Select
                label="Hat"
                value={app.hat_id ?? ANY_HAT}
                onValueChange={(id) =>
                  void run(
                    api.bindHat(app.client_id, id === ANY_HAT ? null : id),
                  )
                }
                options={[
                  {
                    value: ANY_HAT,
                    label: "Picks per chat",
                    description: "The agent chooses the hat that fits, or asks",
                  },
                  ...data.hats.map((h) => ({
                    value: h.id,
                    label: `Always ${h.name}`,
                    description: "Never sees your other hats",
                  })),
                ]}
              />
            )}
          </div>
        ))}
      </Card>
    </>
  );
}

function NewProfile(props: { onDone: (created: boolean) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState<AgentProfile["kind"]>("worker");
  const { busy, error, submit } = useFormSubmit();
  return (
    <form
      className="form"
      onSubmit={(e) =>
        submit(e, () =>
          api
            .createAgentProfile(slug, name, kind)
            .then(() => props.onDone(true)),
        )
      }
    >
      <TextField
        label="Name"
        autoFocus
        required
        maxLength={60}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setSlug(
            e.target.value
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^[^a-z]+|-+$/g, "")
              .slice(0, 24),
          );
        }}
      />
      <TextField
        label="Short id"
        required
        maxLength={24}
        pattern="[a-z][a-z0-9-]*"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
      />
      <Select
        label="Kind"
        value={kind}
        onValueChange={(v) => setKind(v as AgentProfile["kind"])}
        options={[
          { value: "worker", label: "Worker", description: "Does your work" },
          {
            value: "steward",
            label: "Steward",
            description: "Keeps the memory healthy",
          },
        ]}
      />
      <FormFooter
        error={error}
        submitLabel="Create"
        disabled={busy || !name.trim() || !slug}
        onCancel={() => props.onDone(false)}
      />
    </form>
  );
}
