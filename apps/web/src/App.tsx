// The app: panel-frame-ui's dashboard shell (sidebar with Board and Agents, a toolbar with the
// theme picker and sign out) in sky-brain's Constellation Night theme (theme.css), around the
// board (a project picker and the project's goals) or the agents page.
import {
  Alert,
  Button,
  EmptyState,
  PageHeader,
  SelectField,
  Skeleton,
  TextField,
  ThemeProvider,
} from "panel-frame-ui";
import { useCallback, useEffect, useState } from "react";
import { FormFooter, useFormSubmit } from "./FormFooter.tsx";
import { api, ApiError, type Me, type Project } from "./api.ts";
import { Agents } from "./Agents.tsx";
import { AppShell, type Page } from "./AppShell.tsx";
import { Board } from "./Board.tsx";

const PROJECT_KEY = "sky-brain.project";
// The key public/theme-init.js and the sign-in and consent pages read too.
const THEME = { type: "localStorage", key: "sky-brain-theme" } as const;

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
  return (
    <ThemeProvider persistence={THEME} systemMode="resolved">
      <Root />
    </ThemeProvider>
  );
}

function Root() {
  const [me, setMe] = useState<Me | null | "signed-out">(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("board");

  useEffect(() => {
    api.me().then(setMe, (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        // Signed out: the sign-in page (with the brain and how it works) is the way in.
        setMe("signed-out");
        location.replace("/sign-in");
      } else setError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  const signedIn = me !== null && me !== "signed-out" ? me : undefined;
  return (
    <AppShell me={signedIn} page={page} onPage={setPage}>
      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : me === null ? (
        <Skeleton className="loading" />
      ) : me === "signed-out" ? (
        <EmptyState
          title="Sign in to see your board"
          description="Goals and tasks your agents propose wait here for your approval."
          action={
            <a className="pf-button pf-button-primary" href="/sign-in">
              Sign in
            </a>
          }
        />
      ) : page === "board" ? (
        <>
          <PageHeader
            title="Goals"
            description="What your agents propose waits here. Only you approve."
          />
          <Projects me={me} />
        </>
      ) : (
        <>
          <PageHeader
            title="Roles and connected apps"
            description="Name the roles your agents play, and pick the role each app acts as."
          />
          <Agents />
        </>
      )}
    </AppShell>
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
      <Alert tone="error">{error}</Alert>
    ) : (
      <Skeleton className="loading" />
    );
  }
  const current =
    projects.find((p) => p.id === selected) ?? projects[0] ?? null;
  const writable = me.workspaces.filter((w) => w.role !== "viewer");

  return (
    <>
      <section className="toolbar">
        {projects.length > 0 && (
          <SelectField
            label="Project"
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
          </SelectField>
        )}
        {writable.length > 0 && !adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            New project
          </Button>
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
      {error && <Alert tone="error">{error}</Alert>}
      {current ? (
        <Board key={current.id} project={current} />
      ) : (
        !adding && (
          <EmptyState
            title="No projects yet"
            description="Create a project to start a board."
          />
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
  const { busy, error, submit } = useFormSubmit();
  return (
    <form
      className="pf-card form"
      onSubmit={(e) =>
        submit(e, () => api.createProject(workspace, name).then(props.onDone))
      }
    >
      <h2>New project</h2>
      {props.workspaces.length > 1 && (
        <SelectField
          label="Workspace"
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
        >
          {props.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </SelectField>
      )}
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
        submitLabel="Create"
        disabled={busy || !name.trim()}
        onCancel={() => props.onDone(null)}
      />
    </form>
  );
}
