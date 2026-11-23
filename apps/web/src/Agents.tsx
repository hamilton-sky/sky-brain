// The agents page (D25 part 1): name the roles your agents play, and choose which role each
// connected app acts as. Everything an agent writes then carries that role as its byline.
import { useCallback, useEffect, useState } from "react";
import { FormFooter, useFormSubmit } from "./FormFooter.tsx";
import { api, type AgentProfile, type ConnectedApp } from "./api.ts";

const TEMPLATES: { slug: string; name: string; kind: AgentProfile["kind"] }[] =
  [
    { slug: "po", name: "Product owner", kind: "worker" },
    { slug: "doer", name: "Doer", kind: "worker" },
    { slug: "reviewer", name: "Reviewer", kind: "worker" },
    { slug: "librarian", name: "Librarian", kind: "steward" },
  ];

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
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api.agents().then(setData, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const run = (p: Promise<unknown>) =>
    p.then(load, (e: Error) => setError(e.message));

  if (!data) {
    return error ? (
      <p className="error">{error}</p>
    ) : (
      <p className="muted">Loading agents…</p>
    );
  }
  const unused = TEMPLATES.filter(
    (t) => !data.profiles.some((p) => p.slug === t.slug),
  );

  return (
    <>
      {error && <p className="error">{error}</p>}
      <section className="card">
        <div className="section-head">
          <h2>Roles</h2>
          {!adding && (
            <button className="button" onClick={() => setAdding(true)}>
              New role
            </button>
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
            <span>
              <strong>{p.display_name}</strong>{" "}
              <span className="muted small">
                {p.slug} · {p.kind}
              </span>
            </span>
            <button
              className="link"
              onClick={() => void run(api.deleteAgentProfile(p.id))}
            >
              Delete
            </button>
          </div>
        ))}
        {unused.length > 0 && (
          <div className="row">
            <span className="muted small">Quick add:</span>
            {unused.map((t) => (
              <button
                key={t.slug}
                className="button"
                onClick={() =>
                  void run(api.createAgentProfile(t.slug, t.name, t.kind))
                }
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="card">
        <h2>Connected apps</h2>
        {data.apps.length === 0 && (
          <p className="muted">
            No app is connected yet. Add sky-brain as a connector in claude.ai
            or Claude Code first.
          </p>
        )}
        {data.apps.map((app) => (
          <label className="row" key={app.client_id}>
            <span>{appLabel(app)}</span>
            <select
              value={app.profile_id ?? ""}
              onChange={(e) =>
                void run(api.bindApp(app.client_id, e.target.value || null))
              }
            >
              <option value="">Guest</option>
              {data.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </section>
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
      <label>
        <span className="muted">Name</span>
        <input
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
      </label>
      <label>
        <span className="muted">Short id</span>
        <input
          required
          maxLength={24}
          pattern="[a-z][a-z0-9-]*"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
      </label>
      <label>
        <span className="muted">Kind</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as AgentProfile["kind"])}
        >
          <option value="worker">Worker: does your work</option>
          <option value="steward">Steward: keeps the memory healthy</option>
        </select>
      </label>
      <FormFooter
        error={error}
        submitLabel="Create"
        disabled={busy || !name.trim() || !slug}
        onCancel={() => props.onDone(false)}
      />
    </form>
  );
}
