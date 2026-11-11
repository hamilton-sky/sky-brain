// The board page: who is signed in, a project picker, and the project's goals.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Me, type Project } from "./api.ts";
import { Board } from "./Board.tsx";

const PROJECT_KEY = "sky-brain.project";

function remembered(): string | null {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(PROJECT_KEY, id);
  } catch {
    // Private windows may refuse storage; the picker still works.
  }
}

export function App() {
  const [me, setMe] = useState<Me | null | "signed-out">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(setMe, (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) setMe("signed-out");
      else setError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  if (error)
    return (
      <Shell>
        <p className="error">{error}</p>
      </Shell>
    );
  if (me === null)
    return (
      <Shell>
        <p className="muted">Loading…</p>
      </Shell>
    );
  if (me === "signed-out") {
    return (
      <Shell>
        <section className="card center">
          <h2>Sign in to see your board</h2>
          <p className="muted">
            Goals and tasks your agents propose wait here for your approval.
          </p>
          <a className="button primary" href="/sign-in">
            Sign in
          </a>
        </section>
      </Shell>
    );
  }
  return (
    <Shell me={me}>
      <Projects me={me} />
    </Shell>
  );
}

function Shell(props: { me?: Me; children: React.ReactNode }) {
  return (
    <div className="page">
      <header className="top">
        <h1>sky-brain</h1>
        {props.me && (
          <div className="who">
            <span className="muted">{props.me.email}</span>
            <button
              className="link"
              onClick={() => {
                void api.signOut().then(() => location.reload());
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main>{props.children}</main>
    </div>
  );
}

function Projects({ me }: { me: Me }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selected, setSelected] = useState<string | null>(remembered());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.projects().then(setProjects, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (projects === null) {
    return error ? (
      <p className="error">{error}</p>
    ) : (
      <p className="muted">Loading projects…</p>
    );
  }
  const current =
    projects.find((p) => p.id === selected) ?? projects[0] ?? null;
  const writable = me.workspaces.filter((w) => w.role !== "viewer");

  return (
    <>
      <section className="toolbar">
        {projects.length > 0 && (
          <label>
            <span className="muted">Project</span>
            <select
              value={current?.id ?? ""}
              onChange={(e) => {
                setSelected(e.target.value);
                remember(e.target.value);
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {writable.length > 0 && !adding && (
          <button className="button" onClick={() => setAdding(true)}>
            New project
          </button>
        )}
      </section>
      {adding && (
        <NewProject
          workspaces={writable}
          onDone={(p) => {
            setAdding(false);
            if (p) {
              setSelected(p.id);
              remember(p.id);
              load();
            }
          }}
        />
      )}
      {error && <p className="error">{error}</p>}
      {current ? (
        <Board key={current.id} project={current} />
      ) : (
        !adding && (
          <section className="card center">
            <h2>No projects yet</h2>
            <p className="muted">Create a project to start a board.</p>
          </section>
        )
      )}
    </>
  );
}

function NewProject(props: {
  workspaces: Me["workspaces"];
  onDone: (p: Project | null) => void;
}) {
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState(props.workspaces[0]!.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        api.createProject(workspace, name).then(props.onDone, (err: Error) => {
          setError(err.message);
          setBusy(false);
        });
      }}
    >
      <h2>New project</h2>
      {props.workspaces.length > 1 && (
        <label>
          <span className="muted">Workspace</span>
          <select
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
          >
            {props.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span className="muted">Name</span>
        <input
          autoFocus
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="button primary" disabled={busy || !name.trim()}>
          Create
        </button>
        <button
          type="button"
          className="button"
          onClick={() => props.onDone(null)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
