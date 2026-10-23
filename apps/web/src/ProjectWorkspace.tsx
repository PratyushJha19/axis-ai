import { useEffect, useState, type CSSProperties } from "react";
import {
  ChevronLeft,
  Clock3,
  Folder,
  ListTodo,
  NotebookPen,
  Plus,
  Search,
  Settings2,
  Workflow,
} from "lucide-react";
import type {
  Project,
  Task,
  Memory,
} from "../../../packages/shared/src/contracts";
import { api } from "./api";
import { CanvasPage } from "./CanvasLoader";
import { hue } from "./Engage";

const sections = [
  ["Tasks", ListTodo],
  ["Notes", NotebookPen],
  ["Canvas", Workflow],
] as const;
const words = (value: string) => value.replaceAll("_", " ");
const due = (t: Task) =>
  t.due_at
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: t.due_timezone || "UTC",
      }).format(new Date(t.due_at))
    : "No deadline";

export function ProjectWorkspace({
  id,
  refresh,
  onBack,
  onEdit,
  onTask,
  onMemory,
  onCreate,
  onCreateMemory,
  onDirty,
}: {
  id: string;
  refresh: number;
  onBack: () => void;
  onEdit: (p: Project) => void;
  onTask: (t: Task) => void;
  onMemory: (m: Memory) => void;
  onCreate: () => void;
  onCreateMemory: () => void;
  onDirty: (value: boolean) => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]),
    [notes, setNotes] = useState<Memory[]>([]);
  const [tab, setTab] = useState("Tasks"),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    Promise.all([
      api<Project>(`/projects/${id}`),
      api<{ items: Task[]; hasMore: boolean }>(
        `/tasks?project_id=${id}&limit=30&offset=${offset}&q=${encodeURIComponent(query)}`,
      ),
      api<{ items: Memory[]; hasMore: boolean }>(
        `/memories?project_id=${id}&limit=30&offset=${offset}&q=${encodeURIComponent(query)}`,
      ),
    ])
      .then(([p, t, m]) => {
        if (alive) {
          setProject(p);
          setTasks(t.items);
          setNotes(m.items);
          setMore(tab === "Notes" ? m.hasMore : t.hasMore);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, refresh, query, offset, tab]);
  const open = tasks.filter(
    (t) => !["completed", "cancelled"].includes(t.status),
  ).length;
  return (
    <section className="project-workspace">
      <button className="text-button project-back" onClick={onBack}>
        <ChevronLeft size={14} /> All projects
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {project && (
        <>
          <header
            className="panel project-hero"
            style={{ "--hue": hue(project.id) } as CSSProperties}
          >
            <span className="project-hero-icon" aria-hidden="true">
              <Folder size={22} />
            </span>
            <div className="project-hero-copy">
              <span className="eyebrow">PROJECT</span>
              <h1>{project.name}</h1>
              <p>
                {project.description ||
                  "Tasks, notes and ideas for this project."}
              </p>
              <div className="project-hero-meta">
                <span
                  className={`approval-status capitalize tone-${project.status === "active" ? "done" : "muted"}`}
                >
                  {project.status}
                </span>
                {tab === "Tasks" && !loading && (
                  <span className="muted">
                    {open} open · {tasks.length - open} done
                    {more ? " on this page" : ""}
                  </span>
                )}
              </div>
            </div>
            <button className="secondary" onClick={() => onEdit(project)}>
              <Settings2 size={15} /> Project settings
            </button>
          </header>
          <div
            className="segmented"
            role="tablist"
            aria-label="Project sections"
          >
            {sections.map(([t, Icon]) => (
              <button
                role="tab"
                aria-selected={tab === t}
                key={t}
                className={tab === t ? "selected" : ""}
                onClick={() => {
                  if (dirty && !confirm("Discard unsaved canvas changes?"))
                    return;
                  setDirty(false);
                  onDirty(false);
                  setTab(t);
                  setOffset(0);
                  setQuery("");
                }}
              >
                <Icon size={15} aria-hidden="true" />
                {t}
              </button>
            ))}
          </div>
          {tab === "Canvas" ? (
            <CanvasPage
              projectId={id}
              onTask={onTask}
              onDirty={(value) => {
                setDirty(value);
                onDirty(value);
              }}
              refresh={refresh}
            />
          ) : (
            <>
              <div className="list-toolbar project-toolbar">
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label={`Search ${tab.toLowerCase()}`}
                    placeholder={`Search ${tab.toLowerCase()}…`}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setOffset(0);
                    }}
                  />
                </label>
                <button
                  className="primary"
                  onClick={tab === "Tasks" ? onCreate : onCreateMemory}
                >
                  <Plus size={15} /> Add {tab === "Tasks" ? "task" : "note"}
                </button>
              </div>
              {loading ? (
                <p className="loading" role="status">
                  Loading…
                </p>
              ) : tab === "Tasks" ? (
                tasks.length ? (
                  <div className="panel project-tasks">
                    {tasks.map((t) => (
                      <button
                        className={`workspace-row priority-${t.priority} ${["completed", "cancelled"].includes(t.status) ? "is-done" : ""}`}
                        key={t.id}
                        onClick={() => onTask(t)}
                      >
                        <span className="workspace-dot" aria-hidden="true" />
                        <span className="workspace-row-main">
                          <strong>{t.title}</strong>
                          <small>
                            <Clock3 size={12} /> {due(t)}
                          </small>
                        </span>
                        {t.priority !== "normal" && (
                          <span className={`priority ${t.priority}`}>
                            {t.priority}
                          </span>
                        )}
                        <span className="workspace-status capitalize">
                          {words(t.status)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="approvals-empty">
                    <ListTodo size={22} />
                    <strong>
                      {query ? "No matching tasks." : "No tasks yet."}
                    </strong>
                    <span>Add your first next step.</span>
                  </div>
                )
              ) : notes.length ? (
                <div className="project-notes">
                  {notes.map((n) => (
                    <button
                      className="memory-card"
                      key={n.id}
                      onClick={() => onMemory(n)}
                    >
                      <p>{n.content}</p>
                      <footer>
                        <span className="badge">{n.kind}</span>
                        <span className="badge">{n.sensitivity}</span>
                      </footer>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="approvals-empty">
                  <NotebookPen size={22} />
                  <strong>
                    {query ? "No matching notes." : "No project notes yet."}
                  </strong>
                  <span>
                    Capture decisions and context that belong to this project.
                  </span>
                </div>
              )}
              {(offset > 0 || more) && (
                <div className="pagination">
                  <button
                    disabled={!offset}
                    onClick={() => setOffset((n) => Math.max(0, n - 30))}
                  >
                    Previous
                  </button>
                  <span>Page {offset / 30 + 1}</span>
                  <button
                    disabled={!more}
                    onClick={() => setOffset((n) => n + 30)}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
