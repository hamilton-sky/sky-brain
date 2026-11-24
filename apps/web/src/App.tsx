// The app: panel-frame-ui's dashboard shell (sidebar with Board and Agents, a toolbar with the
// theme picker and sign out) in sky-brain's Constellation Night theme (theme.css), around the
// board (a project picker and the project's goals) or the agents page.
import {
  Alert,
  Button,
  EmptyState,
  PageHeader,
  Select,
  Skeleton,
  TextField,
  ThemeProvider,
} from "panel-frame-ui";
import { useCallback, useEffect, useState } from "react";
import { FormFooter, useFormSubmit } from "./FormFooter.tsx";
import { api, ApiError, type Me, type Project } from "./api.ts";
import { Agents } from "./Agents.tsx";
import { ApprovalLink, Approvals } from "./Approvals.tsx";
import { AppShell, type Page } from "./AppShell.tsx";
import { Board } from "./board/Board.tsx";

const PROJECT_KEY = "sky-brain.project";
// An approval link opened while signed out: where to go back to after sign-in.
const RETURN_KEY = "sky-brain.return";

/** The request id of an approval link, `/a/<id>`, or null. */
function approvalLinkId(): string | null {
  return /^\/a\/([0-9a-f-]{36})$/i.exec(location.pathname)?.[1] ?? null;
}

function rememberReturn(): void {
  try {
    if (approvalLinkId()) sessionStorage.setItem(RETURN_KEY, location.pathname);
  } catch {
    // Storage refused: the person lands on Approvals instead.
  }
}

/** After sign-in lands on `/`, go back to the approval link that sent the person there. */
function takeReturn(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return path && /^\/a\/[0-9a-f-]{36}$/i.test(path) ? path : null;
  } catch {
    return null;
  }
}
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
  const [linkId, setLinkId] = useState(approvalLinkId);

  useEffect(() => {
    api.me().then(
      (m) => {
        const back = location.pathname === "/" ? takeReturn() : null;
        if (back) {
          history.replaceState(null, "", back);
          setLinkId(approvalLinkId());
        }
        setMe(m);
      },
      (err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          // Signed out: the sign-in page (with the brain and how it works) is the way in.
          rememberReturn();
          setMe("signed-out");
          location.replace("/sign-in");
        } else setError(err instanceof Error ? err.message : String(err));
      },
    );
  }, []);

  const signedIn = me !== null && me !== "signed-out" ? me : undefined;
  return (
    <AppShell
      me={signedIn}
      page={linkId ? "approvals" : page}
      onPage={(p) => {
        if (linkId) {
          history.replaceState(null, "", "/");
          setLinkId(null);
        }
        setPage(p);
      }}
    >
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
      ) : linkId ? (
        <>
          <PageHeader
            title="An agent is asking"
            description="This is exactly what will change. Only you can approve it."
          />
          <ApprovalLink id={linkId} />
        </>
      ) : page === "approvals" ? (
        <>
          <PageHeader
            title="Approvals"
            description="What your agents asked you to approve, in one place."
          />
          <Approvals />
        </>
      ) : page === "board" ? (
        <>
          <PageHeader
            title="Board"
            description="What your agents propose waits here. Only you approve. Review today's list, or see every goal."
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
          <Select
            label="Project"
            value={current?.id ?? ""}
            onValueChange={(id) => {
              setSelected(id);
              remember(id);
            }}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
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
        <Select
          label="Workspace"
          value={workspace}
          onValueChange={setWorkspace}
          options={props.workspaces.map((w) => ({
            value: w.id,
            label: w.name,
          }))}
        />
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
