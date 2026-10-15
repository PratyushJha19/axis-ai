import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  Bell,
  BellRing,
  ChevronDown,
  Cpu,
  Sun,
  UserRound,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Folder,
  LogOut,
  Menu,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
  Brain,
  ListTodo,
  Clock3,
} from "lucide-react";
import type {
  Profile,
  Project,
  Task,
  Memory,
} from "../../../packages/shared/src/contracts";
import type { Reminder } from "../../../packages/shared/src/reminders";
import { api, ApiError, setCsrf } from "./api";
import { Reminders } from "./Reminders";
import { AISettings, AIChat } from "./AI";
import { Notifications } from "./Notifications";
import {
  burst,
  cheer,
  CountUp,
  hue,
  ProgressRing,
  timeUntil,
  useNow,
} from "./Engage";

type View =
  | "Overview"
  | "Tasks"
  | "Projects"
  | "Memory"
  | "Reminders"
  | "Notifications"
  | "Settings"
  | "AI Settings"
  | "Chat";
const labels: Record<View, string> = {
  Overview: "Today",
  Tasks: "Tasks",
  Projects: "Projects",
  Memory: "Memory",
  Reminders: "Reminders",
  Chat: "Ask AXIS",
  Settings: "Profile",
  Notifications: "Alerts & channels",
  "AI Settings": "AI provider",
};
const settingsViews: View[] = ["Settings", "Notifications", "AI Settings"];
type Kind = "task" | "project" | "memory";
type RecordItem = Task | Project | Memory;
type EditorState = { kind: Kind; record?: RecordItem };
type Page<T> = { items: T[]; hasMore: boolean };
const endpoint = { task: "tasks", project: "projects", memory: "memories" };
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const readable = (text: string) => text.replaceAll("_", " ");
function date(value: string | null, zone: string | null) {
  return value
    ? new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: zone || deviceZone,
      }).format(new Date(value))
    : "No due date";
}
function localInput(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function taskPayload(task: Task) {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    project_id: task.project_id,
    due_at: task.due_at,
    due_timezone: task.due_timezone,
    estimated_minutes: task.estimated_minutes,
    archived: Boolean(task.archived_at),
  };
}

const reminderTime = (r: Reminder) =>
  r.status === "snoozed" && r.next_attempt_at ? r.next_attempt_at : r.due_at;

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <img src="/axis-logo.png" alt="" />
      </span>{" "}
      AXIS<span className="brand-dot">.</span>
    </div>
  );
}
function Empty({
  title,
  children,
  onCreate,
}: {
  title: string;
  children: ReactNode;
  onCreate?: () => void;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol">
        <Sparkles size={24} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {onCreate && (
        <button className="secondary" onClick={onCreate}>
          <Plus size={15} /> Add your first one
        </button>
      )}
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<Profile | null>(null),
    [boot, setBoot] = useState(true),
    [configured, setConfigured] = useState(false);
  const [view, setView] = useState<View>(
      new URLSearchParams(window.location.search).get("view") === "reminders"
        ? "Reminders"
        : "Overview",
    ),
    [mobile, setMobile] = useState(false),
    [editor, setEditor] = useState<EditorState | null>(null),
    [dock, setDock] = useState(() => {
      try {
        return localStorage.getItem("axis.agentDock") !== "closed";
      } catch {
        return true;
      }
    });
  const [settingsOpen, setSettingsOpen] = useState(() => {
    try {
      return localStorage.getItem("axis.settingsNav") !== "closed";
    } catch {
      return true;
    }
  });
  const toggleSettings = (open: boolean) => {
    setSettingsOpen(open);
    try {
      localStorage.setItem("axis.settingsNav", open ? "open" : "closed");
    } catch {
      // Preference is a convenience only.
    }
  };
  const now = useNow();
  const toggleDock = (open: boolean) => {
    setDock(open);
    try {
      localStorage.setItem("axis.agentDock", open ? "open" : "closed");
    } catch {
      // Preference is a convenience only.
    }
  };
  const [projects, setProjects] = useState<Project[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [memories, setMemories] = useState<Memory[]>([]);
  const [projectOptions, setProjectOptions] = useState<Project[]>([]),
    [upcoming, setUpcoming] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [offset, setOffset] = useState(0),
    [hasMore, setHasMore] = useState(false);
  const [refresh, setRefresh] = useState(0),
    [filter, setFilter] = useState("all"),
    [projectFilter, setProjectFilter] = useState("");
  const [stats, setStats] = useState({
    active_tasks: 0,
    completed_tasks: 0,
    projects: 0,
    memories: 0,
  });
  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : "Something went wrong.");
    if (e instanceof ApiError && e.status === 401) {
      setUser(null);
      setCsrf("");
    }
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/auth/status").then((r) => r.json()),
      api<{ user: Profile; csrfToken: string }>("/me").catch((e) => {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }),
    ])
      .then(([status, session]) => {
        if (!active) return;
        setConfigured(status.configured);
        if (session) {
          setUser(session.user);
          setCsrf(session.csrfToken);
        }
      })
      .catch(fail)
      .finally(() => {
        if (active) setBoot(false);
      });
    return () => {
      active = false;
    };
  }, [fail]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!user) return;
    if (!["Overview", "Tasks", "Projects", "Memory"].includes(view)) return;
    let active = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        setError("");
        const params = new URLSearchParams({
          q: query,
          archived: archived ? "all" : "false",
          offset: String(offset),
          limit: "30",
        });
        if (view === "Tasks" && projectFilter)
          params.set("project_id", projectFilter);
        const current =
          view === "Memory"
            ? "memories"
            : view === "Projects"
              ? "projects"
              : "tasks";
        Promise.all([
          api<Page<RecordItem>>(`/${current}?${params}`),
          api<Page<Project>>("/projects?limit=100&archived=all"),
          api<typeof stats>("/summary"),
        ])
          .then(([page, allProjects, summary]) => {
            if (!active) return;
            setProjects(allProjects.items);
            setProjectOptions(allProjects.items);
            setStats(summary);
            setHasMore(page.hasMore);
            if (current === "tasks") setTasks(page.items as Task[]);
            else if (current === "memories")
              setMemories(page.items as Memory[]);
            else setProjects(page.items as Project[]);
          })
          .catch((e) => {
            if (active) fail(e);
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      query ? 250 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [user, view, query, archived, offset, projectFilter, refresh, fail]);
  useEffect(() => {
    if (!user || view !== "Overview") return;
    let active = true;
    api<Page<Reminder>>("/reminders?limit=100&view=active")
      .then((page) => {
        if (!active) return;
        setUpcoming(
          page.items
            .filter((r) =>
              ["scheduled", "snoozed", "processing"].includes(r.status),
            )
            .sort((a, b) => reminderTime(a).localeCompare(reminderTime(b)))
            .slice(0, 4),
        );
      })
      .catch(() => {
        // Reminders have their own page; the overview stays usable without them.
        if (active) setUpcoming([]);
      });
    return () => {
      active = false;
    };
  }, [user, view, refresh]);
  function navigate(next: View) {
    setView(next);
    setQuery("");
    setOffset(0);
    setArchived(false);
    setFilter("all");
    setProjectFilter("");
    setMobile(false);
  }
  function saved() {
    setEditor(null);
    setNotice("Saved to AXIS.");
    setRefresh((n) => n + 1);
  }
  async function complete(task: Task, from?: Element | null) {
    try {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "If-Match": String(task.version) },
        body: JSON.stringify({
          ...taskPayload(task),
          status: task.status === "completed" ? "inbox" : "completed",
        }),
      });
      setRefresh((n) => n + 1);
      if (task.status !== "completed") burst(from ?? null);
      setNotice(
        task.status === "completed"
          ? "Task reopened."
          : `Task completed. ${cheer()}`,
      );
    } catch (e) {
      fail(e);
    }
  }
  async function logout() {
    try {
      await api("/logout", { method: "POST" });
      setCsrf("");
      setUser(null);
      setTasks([]);
      setMemories([]);
      setProjects([]);
      setProjectOptions([]);
    } catch (e) {
      fail(e);
    }
  }

  if (boot)
    return (
      <div className="boot">
        <Brand />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!user)
    return (
      <div className="login-page">
        <header>
          <Brand />
          <span className="eyebrow">YOUR PERSONAL OPERATING SYSTEM</span>
        </header>
        <main className="login-content">
          <div className="login-copy">
            <div className="eyebrow">
              <span className="live-dot" /> EVERYTHING IN SYNC
            </div>
            <h1>
              A little less on
              <br />
              your mind.
            </h1>
            <p>
              One calm place for your projects, commitments, and the things
              worth remembering.
            </p>
            <div className="login-features">
              <span>
                <CheckCircle2 /> Keep track of what matters
              </span>
              <span>
                <Brain /> Build a memory you can trust
              </span>
              <span>
                <ShieldCheck /> Your data. Your decisions.
              </span>
            </div>
          </div>
          <section className="login-card">
            <span className="card-symbol">
              <img src="/axis-logo.png" alt="" />
            </span>
            <h2>Your workspace awaits.</h2>
            <p>
              Sign in with Google to create or open your private AXIS workspace.
              Your tasks, memories and AI keys stay separate from other
              accounts.
            </p>
            {configured ? (
              <a className="primary google" href="/auth/google">
                <span className="google-g">G</span> Continue with Google{" "}
                <ArrowRight size={17} />
              </a>
            ) : (
              <div className="setup-note">
                <strong>Connect Google sign-in</strong>
                <p>
                  Add your Google OAuth client to the local configuration, then
                  restart the API.
                </p>
                <details>
                  <summary>Show setup details</summary>
                  <p>
                    Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
                    SESSION_SECRET in .env. Use the callback:
                  </p>
                  <code>http://localhost:3000/auth/google/callback</code>
                  <p>Full instructions: docs/google-sign-in.md</p>
                </details>
              </div>
            )}
            {(error || new URLSearchParams(location.search).has("login")) && (
              <div role="alert" className="error">
                {error ||
                  "Sign-in could not be verified. Use a verified Google account and try again."}
              </div>
            )}
            <small>
              <ShieldCheck size={14} /> Identity access only. No inbox or
              calendar permissions.
            </small>
          </section>
        </main>
        <footer>
          AXIS <span>Everything in sync.</span>
          <span>Private workspace · Local development</span>
        </footer>
      </div>
    );

  const shownTasks = tasks.filter(
    (t) =>
      filter === "all" ||
      (filter === "completed"
        ? t.status === "completed"
        : filter === "overdue"
          ? t.due_at &&
            new Date(t.due_at) < new Date() &&
            !["completed", "cancelled"].includes(t.status)
          : t.status === "inbox"),
  );
  const projectName = (id: string | null) =>
    projectOptions.find((p) => p.id === id)?.name || "Personal";
  const renderTasks = (items: Task[]) => (
    <div className="task-list">
      {items.map((task) => (
        <div
          className={`task-row ${task.status === "completed" ? "is-complete" : ""}`}
          key={task.id}
        >
          <button
            className="check-task"
            aria-label={`${task.status === "completed" ? "Reopen" : "Complete"} ${task.title}`}
            onClick={(e) => void complete(task, e.currentTarget)}
          >
            {task.status === "completed" && <Check size={14} />}
          </button>
          <button
            className="task-title"
            onClick={() => setEditor({ kind: "task", record: task })}
          >
            <strong>{task.title}</strong>
            <span>
              {projectName(task.project_id)}
              <i /> {readable(task.status)}
              {task.archived_at ? " · archived" : ""}
            </span>
          </button>
          <span className={`priority ${task.priority}`}>{task.priority}</span>
          <span className="due">
            <Clock3 size={13} />
            {date(task.due_at, user.timezone)}
          </span>
          <button
            className="icon-button"
            aria-label={`Edit ${task.title}`}
            onClick={() => setEditor({ kind: "task", record: task })}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      ))}
    </div>
  );
  const taskList = renderTasks(shownTasks);
  const upNext = tasks
    .filter((t) => !["completed", "cancelled"].includes(t.status))
    .slice(0, 6);
  const activeProjects = projects.filter((p) => p.status === "active");
  const totalTasks = stats.completed_tasks + stats.active_tasks,
    doneRate = totalTasks ? stats.completed_tasks / totalTasks : 0,
    firstName = user.display_name.split(" ")[0],
    isSettings = settingsViews.includes(view);
  const heroLine =
    stats.active_tasks === 0
      ? "Inbox zero. Enjoy the quiet, or start something new."
      : doneRate >= 0.75
        ? `You're on fire. Only ${stats.active_tasks} left to clear.`
        : `${stats.active_tasks} open ${stats.active_tasks === 1 ? "task" : "tasks"}. Knock one out and watch the ring fill.`;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <Brand />
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(
            [
              [Sun, "Overview"],
              [ListTodo, "Tasks"],
              [Folder, "Projects"],
              [Brain, "Memory"],
              [BellRing, "Reminders"],
              [Sparkles, "Chat"],
            ] as const
          ).map(([Icon, key]) => (
            <button
              key={key}
              className={`nav-${key.toLowerCase()} ${view === key ? "active" : ""}`}
              onClick={() => navigate(key)}
            >
              <span className="nav-icon">
                <Icon size={17} />
              </span>
              {labels[key]}
              {key === "Tasks" && (
                <span className="nav-count">{stats.active_tasks}</span>
              )}
            </button>
          ))}
          <div className="nav-group">
            <div className="nav-group-head">
              <button
                className={`nav-settings ${isSettings ? "active" : ""}`}
                onClick={() => {
                  toggleSettings(true);
                  navigate("Settings");
                }}
              >
                <span className="nav-icon">
                  <Settings size={17} />
                </span>
                Settings
              </button>
              <button
                className="icon-button nav-chevron"
                aria-label={
                  settingsOpen ? "Collapse settings" : "Expand settings"
                }
                aria-expanded={settingsOpen}
                onClick={() => toggleSettings(!settingsOpen)}
              >
                <ChevronDown size={15} />
              </button>
            </div>
            {(settingsOpen || isSettings) && (
              <div className="nav-sub">
                {(
                  [
                    [UserRound, "Settings"],
                    [Bell, "Notifications"],
                    [Cpu, "AI Settings"],
                  ] as const
                ).map(([Icon, key]) => (
                  <button
                    key={key}
                    className={view === key ? "active" : ""}
                    onClick={() => navigate(key)}
                  >
                    <Icon size={15} />
                    {labels[key]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <span className="avatar">
              {user.display_name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{user.display_name}</strong>
              <small>Personal workspace</small>
            </div>
            <button
              className="icon-button"
              onClick={() => void logout()}
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div
        className={`workspace ${view === "Overview" && dock ? "docked" : ""}`}
      >
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            {isSettings ? "Settings" : "Workspace"} <ChevronRight size={13} />{" "}
            <strong>{labels[view]}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <span className="live-dot" /> Local workspace
            </span>
            <button
              className="primary small"
              onClick={() => setEditor({ kind: "task" })}
            >
              <Plus size={16} /> New task
            </button>
          </div>
        </header>
        <main className="main-content">
          <div
            className={`page-heading ${view === "Overview" ? "sr-only" : ""}`}
          >
            <div>
              <div className="eyebrow">
                {view === "Overview"
                  ? new Intl.DateTimeFormat("en", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      timeZone: user.timezone || deviceZone,
                    })
                      .format(new Date())
                      .toUpperCase()
                  : "YOUR WORKSPACE, ORGANIZED"}
              </div>
              <h1>{view === "Overview" ? labels.Overview : labels[view]}</h1>
              <p>
                {view === "Overview"
                  ? "Make room for a focused day. Here’s where things stand."
                  : view === "Tasks"
                    ? "A clear next step for everything on your plate."
                    : view === "Projects"
                      ? "Keep the bigger picture in view."
                      : view === "Memory"
                        ? "Useful context, right where you left it."
                        : view === "Reminders"
                          ? "Future you says thanks."
                          : view === "Chat"
                            ? "Think out loud. AXIS turns it into action."
                            : view === "Notifications"
                              ? "Choose how and where AXIS reaches you."
                              : view === "AI Settings"
                                ? "Bring your own model and key."
                                : "A workspace that works your way."}
              </p>
            </div>
            {view !== "Overview" &&
              view !== "Chat" &&
              view !== "AI Settings" &&
              view !== "Settings" &&
              view !== "Reminders" &&
              view !== "Notifications" && (
                <button
                  className="secondary"
                  onClick={() =>
                    setEditor({
                      kind:
                        view === "Memory"
                          ? "memory"
                          : view === "Projects"
                            ? "project"
                            : "task",
                    })
                  }
                >
                  <Plus size={16} /> Add{" "}
                  {view === "Memory"
                    ? "memory"
                    : view === "Projects"
                      ? "project"
                      : "task"}
                </button>
              )}
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
              <button
                className="text-button"
                onClick={() => setRefresh((n) => n + 1)}
              >
                Try again
              </button>
            </div>
          )}
          {!user.timezone && (
            <div className="onboarding">
              <Clock3 size={18} />
              <span>Set your timezone so dates feel right.</span>
              <button onClick={() => navigate("Settings")}>
                Set up <ArrowRight size={14} />
              </button>
            </div>
          )}
          {view === "Overview" && (
            <div className={`overview-layout ${dock ? "with-dock" : ""}`}>
              <div className="overview-main">
                <section className="hero">
                  <div className="hero-copy">
                    <span className="eyebrow">
                      {new Intl.DateTimeFormat("en", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        timeZone: user.timezone || deviceZone,
                      })
                        .format(new Date(now))
                        .toUpperCase()}
                    </span>
                    <h1>{`Welcome back, ${firstName}.`}</h1>
                    <p>{heroLine}</p>
                    <div className="hero-actions">
                      <button
                        className="primary"
                        onClick={() => setEditor({ kind: "task" })}
                      >
                        <Plus size={16} /> Capture a task
                      </button>
                      {!dock && (
                        <button
                          className="secondary"
                          onClick={() => toggleDock(true)}
                        >
                          <Sparkles size={16} /> Ask AXIS
                        </button>
                      )}
                    </div>
                  </div>
                  <ProgressRing value={doneRate} size={92} stroke={8}>
                    <strong>
                      <CountUp value={Math.round(doneRate * 100)} />%
                    </strong>
                    <small>complete</small>
                  </ProgressRing>
                </section>
                <div className="stat-tiles">
                  {(
                    [
                      [
                        ListTodo,
                        "Open tasks",
                        stats.active_tasks,
                        "Tasks",
                        "blue",
                      ],
                      [
                        CheckCircle2,
                        "Completed",
                        stats.completed_tasks,
                        "Tasks",
                        "green",
                      ],
                      [
                        Folder,
                        "Projects",
                        stats.projects,
                        "Projects",
                        "violet",
                      ],
                      [Brain, "Memories", stats.memories, "Memory", "teal"],
                    ] as const
                  ).map(([Icon, label, count, target, tone]) => (
                    <button
                      key={label}
                      className={`stat-tile tone-${tone}`}
                      onClick={() => navigate(target)}
                    >
                      <span className="stat-tile-icon">
                        <Icon size={18} />
                      </span>
                      <strong>
                        <CountUp value={count} />
                      </strong>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <section className="panel overview-card">
                  <div className="section-title">
                    <h2>Up next</h2>
                    <button
                      className="text-button"
                      onClick={() => navigate("Tasks")}
                    >
                      All tasks <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {loading ? (
                    <p className="loading" role="status">
                      Loading your tasks…
                    </p>
                  ) : upNext.length ? (
                    renderTasks(upNext)
                  ) : (
                    <Empty
                      title="Nothing on your plate."
                      onCreate={() => setEditor({ kind: "task" })}
                    >
                      Add a task here, or just ask AXIS.
                    </Empty>
                  )}
                  <button
                    className="add-row"
                    onClick={() => setEditor({ kind: "task" })}
                  >
                    <Plus size={17} /> Add a task
                  </button>
                </section>
                <div className="overview-pair">
                  <section
                    className="overview-cards"
                    aria-labelledby="coming-up"
                  >
                    <div className="cards-heading">
                      <h2 id="coming-up">Coming up</h2>
                      <button
                        className="text-button"
                        onClick={() => navigate("Reminders")}
                      >
                        All reminders <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <div className="mini-cards">
                      {upcoming.map((r) => {
                        const when = new Date(reminderTime(r)),
                          left = timeUntil(reminderTime(r), now);
                        return (
                          <button
                            key={r.id}
                            className={`mini-card reminder-card tone-${left.tone}`}
                            onClick={() => navigate("Reminders")}
                          >
                            <span className="mini-card-top">
                              <span className="mini-card-icon">
                                <BellRing size={15} />
                              </span>
                              <span className="countdown">{left.text}</span>
                            </span>
                            <strong>{r.title}</strong>
                            <small>
                              {new Intl.DateTimeFormat("en", {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                                timeZone: user.timezone || deviceZone,
                              }).format(when)}
                              {r.recurrence !== "none" && ` · ${r.recurrence}`}
                              {r.status === "snoozed" && " · snoozed"}
                            </small>
                          </button>
                        );
                      })}
                      {upcoming.length === 0 && (
                        <button
                          className="mini-card mini-card-empty"
                          onClick={() => navigate("Reminders")}
                        >
                          <span className="mini-card-icon">
                            <Plus size={15} />
                          </span>
                          <strong>No upcoming reminders</strong>
                          <small>Add one, or ask AXIS</small>
                        </button>
                      )}
                    </div>
                  </section>
                  <section
                    className="overview-cards"
                    aria-labelledby="projects-heading"
                  >
                    <div className="cards-heading">
                      <h2 id="projects-heading">Projects</h2>
                      <button
                        className="text-button"
                        onClick={() => navigate("Projects")}
                      >
                        All projects <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <div className="mini-cards">
                      {activeProjects.slice(0, 4).map((p) => (
                        <button
                          key={p.id}
                          className="mini-card project-card"
                          style={{ "--hue": hue(p.id) } as CSSProperties}
                          onClick={() =>
                            setEditor({ kind: "project", record: p })
                          }
                        >
                          <span className="mini-card-icon">
                            <Folder size={15} />
                          </span>
                          <strong>{p.name}</strong>
                          <small>{p.description || "No description"}</small>
                        </button>
                      ))}
                      {activeProjects.length === 0 && (
                        <button
                          className="mini-card mini-card-empty"
                          onClick={() => setEditor({ kind: "project" })}
                        >
                          <span className="mini-card-icon">
                            <Plus size={15} />
                          </span>
                          <strong>Start a project</strong>
                          <small>Group related tasks together</small>
                        </button>
                      )}
                    </div>
                  </section>
                </div>
                <div className="quick-actions">
                  <button
                    className="secondary"
                    onClick={() => setEditor({ kind: "memory" })}
                  >
                    <Brain size={16} /> Save a memory
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setEditor({ kind: "project" })}
                  >
                    <Folder size={16} /> New project
                  </button>
                </div>
              </div>
              {dock ? (
                <aside className="agent-dock" aria-label="AXIS agent">
                  <AIChat
                    onError={fail}
                    compact
                    toolbar={
                      <button
                        className="ai-icon-button"
                        aria-label="Close agent panel"
                        title="Close agent panel"
                        onClick={() => toggleDock(false)}
                      >
                        <PanelRightClose size={16} />
                      </button>
                    }
                  />
                </aside>
              ) : (
                <button
                  className="agent-dock-tab"
                  aria-label="Open agent panel"
                  title="Open agent panel"
                  onClick={() => toggleDock(true)}
                >
                  <img src="/axis-logo.png" alt="" />
                  <span>AXIS</span>
                </button>
              )}
            </div>
          )}
          {["Tasks", "Projects", "Memory"].includes(view) && (
            <>
              <div className="list-toolbar">
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label={`Search ${view.toLowerCase()}`}
                    placeholder={`Search ${view.toLowerCase()}…`}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setOffset(0);
                    }}
                  />
                </label>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={archived}
                    onChange={(e) => {
                      setArchived(e.target.checked);
                      setOffset(0);
                    }}
                  />{" "}
                  Include archived
                </label>
                {view === "Tasks" && (
                  <label className="project-filter">
                    <Folder size={15} />
                    <span className="sr-only">Filter by project</span>
                    <select
                      value={projectFilter}
                      onChange={(e) => {
                        setProjectFilter(e.target.value);
                        setOffset(0);
                      }}
                    >
                      <option value="">All projects</option>
                      {projectOptions
                        .filter((p) => p.status !== "archived" || archived)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </div>
              {view === "Tasks" && (
                <div className="tabs">
                  {[
                    ["all", "All tasks"],
                    ["inbox", "Inbox"],
                    ["overdue", "Overdue"],
                    ["completed", "Completed"],
                  ].map(([value, label]) => (
                    <button
                      aria-pressed={filter === value}
                      className={filter === value ? "selected" : ""}
                      key={value}
                      onClick={() => setFilter(value!)}
                    >
                      {label}
                    </button>
                  ))}
                  <small>Filters apply to this page</small>
                </div>
              )}
              {loading ? (
                <p role="status" className="loading">
                  Loading…
                </p>
              ) : view === "Tasks" ? (
                <section className="panel">
                  {shownTasks.length ? (
                    taskList
                  ) : (
                    <Empty
                      title="A little breathing room."
                      onCreate={() => setEditor({ kind: "task" })}
                    >
                      No tasks match this view.
                    </Empty>
                  )}
                </section>
              ) : view === "Projects" ? (
                <div className="entity-grid">
                  {projects.map((p) => (
                    <button
                      className="project-card"
                      key={p.id}
                      onClick={() => setEditor({ kind: "project", record: p })}
                    >
                      <div>
                        <span className="folder-symbol">
                          <Folder size={21} />
                        </span>
                        <span className="badge">{p.status}</span>
                      </div>
                      <h2>{p.name}</h2>
                      <p>
                        {p.description ||
                          "A place for related tasks, decisions, and context."}
                      </p>
                      <footer>
                        Open project <ArrowUpRight size={16} />
                      </footer>
                    </button>
                  ))}
                  {!projects.length && (
                    <Empty
                      title="Give your work a home."
                      onCreate={() => setEditor({ kind: "project" })}
                    >
                      Bring related tasks and memory together in a project.
                    </Empty>
                  )}
                </div>
              ) : (
                <div className="entity-grid">
                  {memories.map((m) => (
                    <button
                      className="memory-card"
                      key={m.id}
                      onClick={() => setEditor({ kind: "memory", record: m })}
                    >
                      <div className="memory-top">
                        <span className={`badge ${m.truth_status}`}>
                          {m.truth_status}
                        </span>
                        <span>{m.kind}</span>
                      </div>
                      <p>{m.content}</p>
                      <div className="memory-meta">
                        <span>
                          <Folder size={12} />
                          {projectName(m.project_id)}
                        </span>
                        <span>
                          {m.sensitivity === "sensitive"
                            ? "Sensitive · consent saved"
                            : "Ordinary"}
                        </span>
                      </div>
                      <footer>
                        Source: you · {date(m.updated_at, user.timezone)}
                        {m.archived_at ? " · archived" : ""}
                      </footer>
                    </button>
                  ))}
                  {!memories.length && (
                    <Empty
                      title="A place for what you know."
                      onCreate={() => setEditor({ kind: "memory" })}
                    >
                      Save useful context with its source and certainty.
                    </Empty>
                  )}
                </div>
              )}
              <div className="pagination">
                <button
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset(Math.max(0, offset - 30))}
                >
                  Previous
                </button>
                <span>Page {Math.floor(offset / 30) + 1}</span>
                <button
                  disabled={!hasMore || loading}
                  onClick={() => setOffset(offset + 30)}
                >
                  Next
                </button>
              </div>
            </>
          )}
          {view === "Reminders" && <Reminders user={user} onError={fail} />}
          {view === "Notifications" && (
            <Notifications onError={fail} timezone={user.timezone} />
          )}
          {view === "AI Settings" && <AISettings onError={fail} />}
          {view === "Chat" && <AIChat onError={fail} />}
          {view === "Settings" && (
            <section className="panel settings-panel">
              <h2>Your profile</h2>
              <p className="muted">Signed in with Google as {user.email}</p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  try {
                    const result = await api<{ user: Profile }>("/me", {
                      method: "PATCH",
                      body: JSON.stringify({
                        display_name: data.get("name"),
                        timezone: data.get("timezone"),
                      }),
                    });
                    setUser(result.user);
                    setNotice("Profile saved.");
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                <label>
                  Display name
                  <input
                    name="name"
                    defaultValue={user.display_name}
                    required
                    maxLength={120}
                  />
                </label>
                <label>
                  IANA timezone
                  <input
                    name="timezone"
                    defaultValue={user.timezone || deviceZone}
                    required
                    placeholder="Asia/Kolkata"
                  />
                </label>
                <p className="help">
                  Confirm your timezone. Task due-time entry uses the device
                  timezone shown in its form.
                </p>
                <button className="primary" type="submit">
                  Save profile
                </button>
              </form>
              <div className="settings-divider" />
              <h3>Private by design</h3>
              <p>
                Google is used for sign-in only. Your records live in the local
                PostgreSQL database. No messages or calendar changes are sent
                from this build.
              </p>
              <button className="secondary" onClick={() => void logout()}>
                <LogOut size={16} /> Sign out
              </button>
            </section>
          )}
          <div className="workspace-footer">
            <span>
              <span className="live-dot" /> Everything has a place.
            </span>
            <span>{user.timezone || "Timezone not set"} · AXIS</span>
          </div>
        </main>
      </div>
      {notice && (
        <div role="status" className="toast">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {editor && (
        <Editor
          state={editor}
          projects={projectOptions}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function Editor({
  state,
  projects,
  onClose,
  onSaved,
}: {
  state: EditorState;
  projects: Project[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const [history, setHistory] = useState<
    { id: string; event_type: string; to_status: string; created_at: string }[]
  >([]);
  const key = useRef(crypto.randomUUID()),
    { kind, record } = state;
  const task = kind === "task" ? (record as Task | undefined) : undefined,
    memory = kind === "memory" ? (record as Memory | undefined) : undefined,
    project = kind === "project" ? (record as Project | undefined) : undefined;
  const [scope, setScope] = useState(memory?.scope || "global"),
    [sensitivity, setSensitivity] = useState(memory?.sensitivity || "");
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    element
      ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        "form input, form textarea",
      )
      ?.focus();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    if (task)
      api<{ items: typeof history }>(`/tasks/${task.id}/events`)
        .then((r) => setHistory(r.items))
        .catch(() => setError("Task history could not be loaded."));
  }, [task]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const projectId = String(form.get("project_id") || "") || null;
    let payload: unknown;
    if (kind === "project")
      payload = {
        name: form.get("name"),
        description: form.get("description"),
        status: form.get("status"),
      };
    else if (kind === "task")
      payload = {
        title: form.get("title"),
        description: form.get("description"),
        status: form.get("status"),
        priority: form.get("priority"),
        project_id: projectId,
        due_at: form.get("due")
          ? new Date(String(form.get("due"))).toISOString()
          : null,
        due_timezone: form.get("due") ? deviceZone : null,
        estimated_minutes: form.get("estimate")
          ? Number(form.get("estimate"))
          : null,
        archived: form.get("archived") === "on",
      };
    else
      payload = {
        content: form.get("content"),
        kind: form.get("kind"),
        truth_status: form.get("truth_status"),
        scope,
        project_id: scope === "project" ? projectId : null,
        sensitivity,
        consent: form.get("consent") === "on",
        archived: form.get("archived") === "on",
      };
    try {
      await api(`/${endpoint[kind]}${record ? `/${record.id}` : ""}`, {
        method: record ? "PATCH" : "POST",
        headers: record
          ? { "If-Match": String(record.version) }
          : { "Idempotency-Key": key.current },
        body: JSON.stringify(payload),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!record) return;
    setBusy(true);
    try {
      await api(`/${endpoint[kind]}/${record.id}`, {
        method: "DELETE",
        headers: { "If-Match": String(record.version) },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="editor"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="editor-title"
    >
      <div className="editor-header">
        <div>
          <span className="eyebrow">
            {record ? "MAKE IT YOURS" : "A LITTLE MORE CLARITY"}
          </span>
          <h2 id="editor-title">
            {record ? "Edit" : "New"} {kind}
          </h2>
        </div>
        <button
          className="icon-button"
          type="button"
          disabled={busy}
          aria-label="Close editor"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <form onSubmit={submit}>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {kind === "project" ? (
          <>
            <label>
              Project name
              <input
                name="name"
                required
                autoFocus
                maxLength={120}
                defaultValue={project?.name}
                placeholder="What are you working toward?"
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                rows={3}
                maxLength={3000}
                defaultValue={project?.description}
              />
            </label>
            <label>
              Status
              <select name="status" defaultValue={project?.status || "active"}>
                {["active", "paused", "completed", "archived"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </>
        ) : kind === "task" ? (
          <>
            <label>
              Task title
              <input
                name="title"
                required
                autoFocus
                maxLength={200}
                defaultValue={task?.title}
                placeholder="What needs to happen?"
              />
            </label>
            <label>
              Notes
              <textarea
                name="description"
                rows={3}
                maxLength={5000}
                defaultValue={task?.description}
                placeholder="A little context for your future self"
              />
            </label>
            <div className="form-grid">
              <label>
                Status
                <select name="status" defaultValue={task?.status || "inbox"}>
                  {[
                    "inbox",
                    "planned",
                    "in_progress",
                    "blocked",
                    "completed",
                    "cancelled",
                    "deferred",
                  ].map((v) => (
                    <option value={v} key={v}>
                      {readable(v)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  name="priority"
                  defaultValue={task?.priority || "normal"}
                >
                  {["low", "normal", "high", "critical"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Due time · {deviceZone}
              <input
                type="datetime-local"
                name="due"
                defaultValue={localInput(task?.due_at || null)}
              />
            </label>
            <p className="help">
              Optional. This saves a deadline; reminders are not enabled yet.
            </p>
            <label>
              Estimated minutes
              <input
                type="number"
                min="1"
                max="100000"
                name="estimate"
                defaultValue={task?.estimated_minutes || ""}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              What would you like to remember?
              <textarea
                name="content"
                autoFocus
                required
                rows={5}
                maxLength={10000}
                defaultValue={memory?.content}
                placeholder="A preference, a decision, or useful context…"
              />
            </label>
            <div className="form-grid">
              <label>
                Type
                <select name="kind" defaultValue={memory?.kind || "fact"}>
                  {[
                    "fact",
                    "preference",
                    "decision",
                    "context",
                    "routine",
                    "relationship",
                    "other",
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Certainty
                <select
                  name="truth_status"
                  defaultValue={memory?.truth_status || "confirmed"}
                >
                  {["confirmed", "assumed", "suggested"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Scope
              <select
                value={scope}
                onChange={(e) =>
                  setScope(e.target.value as "global" | "project")
                }
              >
                <option value="global">Global memory</option>
                <option value="project">Project memory</option>
              </select>
            </label>
            <label>
              Privacy classification
              <select
                required
                value={sensitivity}
                onChange={(e) => setSensitivity(e.target.value)}
              >
                <option value="" disabled>
                  Choose how personal this is
                </option>
                <option value="ordinary">
                  Ordinary, non-sensitive context
                </option>
                <option value="sensitive">
                  Sensitive or personal information
                </option>
              </select>
            </label>
            {sensitivity === "sensitive" && (
              <label className="consent">
                <input type="checkbox" name="consent" required /> I explicitly
                consent to saving this sensitive information.
              </label>
            )}
            <p className="help">
              Never store passwords, API keys, or credentials here. Source is
              recorded as “you”.
            </p>
          </>
        )}
        {(kind === "task" || (kind === "memory" && scope === "project")) && (
          <label>
            Project
            <select
              name="project_id"
              required={kind === "memory"}
              defaultValue={task?.project_id || memory?.project_id || ""}
            >
              <option value="">
                {kind === "memory"
                  ? "Select a project"
                  : "Personal · no project"}
              </option>
              {projects.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {record && kind !== "project" && (
          <label className="inline-check">
            <input
              type="checkbox"
              name="archived"
              defaultChecked={Boolean(task?.archived_at || memory?.archived_at)}
            />{" "}
            Archive this {kind}
          </label>
        )}
        {task && history.length > 0 && (
          <details className="history">
            <summary>Task history</summary>
            {history.map((event) => (
              <p key={event.id}>
                {readable(event.event_type)} → {readable(event.to_status)}{" "}
                <small>{date(event.created_at, deviceZone)}</small>
              </p>
            ))}
          </details>
        )}
        <div className="editor-actions">
          {record && (
            <button
              type="button"
              className="danger-text"
              onClick={() => setDeleting(!deleting)}
              disabled={busy}
            >
              Delete
            </button>
          )}
          <span />
          <button
            className="secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save " + kind}
          </button>
        </div>
        {deleting && (
          <div className="delete-confirm">
            <p>Delete this {kind} permanently? Its content will be removed.</p>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              Yes, delete {kind}
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
