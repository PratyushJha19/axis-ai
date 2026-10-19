import { useCallback, useEffect, useState, useRef } from "react";
import { Temporal } from "@js-temporal/polyfill";
import {
  ArrowUpRight,
  CalendarClock,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Clock3,
  ExternalLink,
  Flame,
  FolderOpen,
  Lightbulb,
  ListChecks,
  Plus,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  TriangleAlert,
  X,
} from "lucide-react";
import type {
  Briefing,
  Plan,
  PlanDocument,
  PlanningPreferences,
} from "../../../packages/shared/src/planning";
import type { Task } from "../../../packages/shared/src/contracts";
import { api } from "./api";
type Props = {
  onError: (e: unknown) => void;
  onOpen: (kind: "task" | "project", id: string) => void;
  revision: number;
  onDirty?: (v: boolean) => void;
  compact?: boolean;
  onExpand?: () => void;
};
type PlanDetail = Plan & {
  progress: {
    task_id: string;
    status: string;
    changed: boolean;
    missed: boolean;
  }[];
};
type Recovery = {
  task: Task;
  reminders: {
    id: string;
    title: string;
    due_at: string;
    version: number;
    status: string;
  }[];
};
const send = (body: unknown, method = "POST") => ({
  method,
  body: JSON.stringify(body),
});
const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const label = (value: string) => value.replaceAll("_", " ");
const planTone = (status: string) =>
  status === "accepted" ? "done" : status === "discarded" ? "muted" : "review";
const wall = (iso: string, zone: string) =>
  Temporal.Instant.from(iso)
    .toZonedDateTimeISO(zone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
export function Planning({
  onError,
  onOpen,
  revision,
  onDirty,
  compact = false,
  onExpand,
}: Props) {
  const [brief, setBrief] = useState<Briefing | null>(null),
    [prefs, setPrefs] = useState<{
      value: PlanningPreferences;
      version: number;
    } | null>(null),
    [history, setHistory] = useState<Plan[]>([]),
    [plan, setPlan] = useState<PlanDetail | null>(null),
    [document, setDocument] = useState<PlanDocument | null>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [date, setDate] = useState(""),
    [kind, setKind] = useState<"daily" | "weekly">("daily"),
    [mode, setMode] = useState<"priority" | "timeblock">("priority"),
    [selected, setSelected] = useState<string[]>([]),
    [consent, setConsent] = useState(false),
    [memory, setMemory] = useState(""),
    [recovery, setRecovery] = useState<Recovery | null>(null),
    [due, setDue] = useState(""),
    [policy, setPolicy] = useState<"cancel" | "shift">("cancel"),
    [confirmed, setConfirmed] = useState(false),
    [page, setPage] = useState(0),
    [historyOffset, setHistoryOffset] = useState(0),
    [more, setMore] = useState(false);
  const planRequest = useRef(crypto.randomUUID()),
    recoveryRequest = useRef(crypto.randomUUID()),
    recoveryPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (recovery)
      recoveryPanel.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  }, [recovery]);
  useEffect(() => {
    planRequest.current = crypto.randomUUID();
  }, [date, kind, mode, selected]);
  useEffect(() => {
    recoveryRequest.current = crypto.randomUUID();
  }, [recovery, due, policy]);
  const refresh = useCallback(async () => {
    const b = await api<Briefing>("/intelligence/briefing");
    setBrief(b);
    setDate((old) => old || b.date);
    if (!compact) {
      const [p, h] = await Promise.all([
        api<{ value: PlanningPreferences; version: number }>(
          "/planning-preferences",
        ),
        api<{ items: Plan[]; hasMore: boolean }>(
          `/plans?offset=${historyOffset}`,
        ),
      ]);
      setPrefs(p);
      setHistory(h.items);
      setMore(h.hasMore);
    }
  }, [compact, historyOffset]);
  useEffect(() => {
    void refresh().catch(onError);
  }, [refresh, onError, revision]);
  useEffect(() => {
    onDirty?.(dirty);
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      onDirty?.(false);
    };
  }, [dirty, onDirty]);
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  function choose(p: PlanDetail) {
    setPlan(p);
    setDocument(p.document);
    setDirty(false);
  }
  function editDoc(next: PlanDocument) {
    setDocument(next);
    setDirty(true);
  }
  async function generate() {
    if (dirty && !window.confirm("Discard unsaved plan edits?")) return;
    await perform(async () => {
      choose(
        await api<PlanDetail>(
          "/plans/generate",
          send({
            idempotency_key: planRequest.current,
            date,
            kind,
            mode,
            ...(selected.length ? { task_ids: selected } : {}),
          }),
        ),
      );
      planRequest.current = crypto.randomUUID();
      await refresh();
    });
  }
  async function change(operation: "edit" | "accept" | "discard") {
    if (!plan || !document) return;
    await perform(async () => {
      choose(
        await api<PlanDetail>(
          `/plans/${plan.id}`,
          send({
            version: plan.version,
            operation,
            ...(operation !== "discard" ? { document } : {}),
          }),
        ),
      );
      setNotice(
        operation === "accept"
          ? "Plan accepted. Task deadlines and reminders are unchanged."
          : operation === "discard"
            ? "Plan discarded. Tasks are unchanged."
            : "Draft saved.",
      );
      await refresh();
    });
  }
  const showTime = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("en", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: brief!.timezone,
        }).format(new Date(iso))
      : "No due date";
  const openRecovery = (taskId: string) =>
    void perform(async () => {
      setRecovery(await api<Recovery>(`/intelligence/recovery/${taskId}`));
      setConfirmed(false);
      setDue("");
    });
  const updatePrefs = (patch: Partial<PlanningPreferences>) =>
    prefs && setPrefs({ ...prefs, value: { ...prefs.value, ...patch } });
  const updateWindow = (
    i: number,
    patch: Partial<PlanningPreferences["windows"][number]>,
  ) =>
    prefs &&
    updatePrefs({
      windows: prefs.value.windows.map((x, j) =>
        i === j ? { ...x, ...patch } : x,
      ),
    });
  const titleOf = (id: string) =>
    brief?.priorities.find((t) => t.id === id)?.title ??
    brief?.completed.find((t) => t.id === id)?.title;
  if (!brief)
    return (
      <section className="panel intel-card">
        <p className="loading" role="status">
          Loading daily intelligence… Set your profile timezone if it is
          missing.
        </p>
      </section>
    );
  const longDate = Temporal.PlainDate.from(brief.date).toLocaleString("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const stats = (
    <div className="intel-stats">
      <span className="intel-stat tone-amber">
        <CalendarClock size={15} />
        <strong>{brief.due_today.length}</strong> due today
      </span>
      <span
        className={`intel-stat ${brief.overdue.length ? "tone-red" : "tone-muted"}`}
      >
        <TriangleAlert size={15} />
        <strong>{brief.overdue.length}</strong> overdue
      </span>
      <span className="intel-stat tone-green">
        <CircleCheck size={15} />
        <strong>{brief.completed.length}</strong> completed this week
      </span>
      {!compact && (
        <span className="intel-stat tone-violet">
          <FolderOpen size={15} />
          <strong>{brief.projects.length}</strong> projects
        </span>
      )}
    </div>
  );
  if (compact)
    return (
      <section className="panel intel-card" aria-labelledby="intel-heading">
        <div className="section-title">
          <div>
            <span className="eyebrow">TODAY&apos;S FOCUS</span>
            <h2 id="intel-heading">Daily intelligence</h2>
          </div>
          <button className="text-button" onClick={onExpand}>
            Open daily and weekly planning <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="intel-body">
          {stats}
          {brief.priorities.length ? (
            <ol className="intel-priorities">
              {brief.priorities.slice(0, 3).map((t, i) => (
                <li key={t.id}>
                  <span className="intel-rank">{i + 1}</span>
                  <div>
                    <button
                      className="intel-title"
                      onClick={() => onOpen("task", t.id)}
                    >
                      {t.title}
                    </button>
                    <span className="planning-tags">
                      {t.reasons.map((r) => (
                        <span key={r}>{r}</span>
                      ))}
                    </span>
                  </div>
                  {t.priority !== "normal" && t.priority !== "low" && (
                    <span className={`priority ${t.priority}`}>
                      {t.priority}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="intel-empty">
              <Sparkles size={15} /> No active priorities. Capture a task to
              start planning.
            </p>
          )}
        </div>
      </section>
    );
  return (
    <div className="planning">
      <section className="panel planning-brief" aria-labelledby="brief-heading">
        <div className="planning-brief-head">
          <div>
            <span className="eyebrow">
              {longDate.toUpperCase()} · {brief.timezone}
            </span>
            <h2 id="brief-heading">Your briefing · {brief.date}</h2>
            <p className="muted">
              Facts from saved records. Calendar is not connected. Week started{" "}
              {brief.week_start}.
            </p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void perform(refresh)}
          >
            <RefreshCw size={15} /> Refresh facts
          </button>
        </div>
        {stats}
        {brief.limited && (
          <p className="planning-note tone-amber">
            <TriangleAlert size={15} /> Source is limited to 500 tasks and 200
            projects; review the Tasks view for additional records.
          </p>
        )}
        <p role="status" className="approvals-notice planning-notice">
          {notice && <Check size={15} />}
          {notice}
        </p>
        <details className="approvals-info planning-facts">
          <summary>
            <ListChecks size={16} /> Due today, upcoming commitments and project
            context
            <ChevronDown size={16} className="approvals-chevron" />
          </summary>
          <div className="planning-fact-grid">
            <div>
              <h3>Due today</h3>
              {brief.due_today.map((t) => (
                <p key={t.id}>
                  <button onClick={() => onOpen("task", t.id)}>
                    {t.title}
                  </button>
                  <small>{showTime(t.due_at)}</small>
                </p>
              ))}
              {!brief.due_today.length && <small>Nothing due today.</small>}
            </div>
            <div>
              <h3>Upcoming tasks</h3>
              {brief.upcoming.slice(0, 20).map((t) => (
                <p key={t.id}>
                  <button onClick={() => onOpen("task", t.id)}>
                    {t.title}
                  </button>
                  <small>{showTime(t.due_at)}</small>
                </p>
              ))}
              {!brief.upcoming.length && <small>No upcoming tasks.</small>}
            </div>
            <div>
              <h3>Scheduled reminders</h3>
              {brief.reminders.map((r) => (
                <p key={r.id}>
                  <span>{r.title}</span>
                  <small>
                    {showTime(r.due_at)} · {r.status} (not task completion
                    evidence)
                  </small>
                </p>
              ))}
              {!brief.reminders.length && (
                <small>No reminders scheduled.</small>
              )}
            </div>
            <div>
              <h3>Projects</h3>
              {brief.projects.map((p) => (
                <p key={p.id}>
                  <button onClick={() => onOpen("project", p.id)}>
                    {p.name}
                  </button>
                  <small>
                    {p.open} open · {p.overdue} overdue · {p.blocked} blocked
                    {p.open === 0 && " · Consider capturing the next task."}
                  </small>
                </p>
              ))}
              {!brief.projects.length && <small>No projects yet.</small>}
            </div>
            <div>
              <h3>Completed work this week</h3>
              {brief.completed.map((t) => (
                <p key={t.id}>
                  <button onClick={() => onOpen("task", t.id)}>
                    {t.title}
                  </button>
                  <small>{showTime(t.completion_at)}</small>
                </p>
              ))}
              {!brief.completed.length && <small>Nothing completed yet.</small>}
            </div>
          </div>
          {brief.missing.map((m) => (
            <p key={m} className="planning-missing">
              {m}
            </p>
          ))}
        </details>
      </section>
      {recovery && (
        <section
          ref={recoveryPanel}
          className="panel planning-recovery"
          aria-label="Rescheduling review"
        >
          <div className="section-title">
            <div>
              <span className="eyebrow">RESCHEDULE</span>
              <h2>Reschedule {recovery.task.title}</h2>
            </div>
            <button
              className="icon-button"
              aria-label="Close rescheduling review"
              onClick={() => setRecovery(null)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="planning-body">
            <p className="muted">
              Current due: {showTime(recovery.task.due_at)}. Review linked
              reminders before confirming.
            </p>
            {recovery.reminders.length > 0 && (
              <ul className="planning-reminders">
                {recovery.reminders.map((r) => (
                  <li key={r.id}>
                    <strong>{r.title}</strong>
                    <small>
                      {showTime(r.due_at)} · {r.status}
                    </small>
                  </li>
                ))}
              </ul>
            )}
            <div className="planning-fields">
              <label className="field">
                New due time ({brief.timezone})
                <input
                  type="datetime-local"
                  value={due}
                  onChange={(e) => {
                    setDue(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
              <label className="field">
                Linked reminder changes
                <select
                  value={policy}
                  onChange={(e) => {
                    setPolicy(e.target.value as typeof policy);
                    setConfirmed(false);
                  }}
                >
                  <option value="cancel">Cancel active linked reminders</option>
                  <option value="shift">
                    Shift reminders by the same due-time difference
                  </option>
                </select>
              </label>
            </div>
            <p className="planning-note tone-red">
              <TriangleAlert size={15} /> Dispatch already started or
              unresolved? The whole change will be refused. Sent messages cannot
              be recalled.
            </p>
            <label className="planning-consent">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed the new due time and selected linked reminder changes.
            </label>
            <div className="planning-actions">
              <button
                className="primary"
                disabled={busy || !due || !confirmed}
                onClick={() =>
                  void perform(async () => {
                    await api(
                      `/intelligence/recovery/${recovery.task.id}`,
                      send({
                        idempotency_key: recoveryRequest.current,
                        version: recovery.task.version,
                        local_due: due,
                        reminders: recovery.reminders.map((r) => ({
                          id: r.id,
                          version: r.version,
                        })),
                        reminder_policy: policy,
                        confirmed: true,
                      }),
                    );
                    setRecovery(null);
                    setNotice("Task and linked reminders updated together.");
                    await refresh();
                  })
                }
              >
                <Check size={15} /> Confirm rescheduling
              </button>
              <button className="secondary" onClick={() => setRecovery(null)}>
                Leave unchanged
              </button>
            </div>
          </div>
        </section>
      )}
      <div className="planning-grid">
        <div className="planning-column">
          <section className="panel" aria-labelledby="plans-heading">
            <div className="section-title">
              <div>
                <span className="eyebrow">PLAN BUILDER</span>
                <h2 id="plans-heading">Daily and weekly plans</h2>
              </div>
              <span className="planning-selected">
                {selected.length
                  ? `${selected.length} selected`
                  : "Top priorities"}
                {selected.length > 0 && (
                  <button
                    className="text-button"
                    onClick={() => setSelected([])}
                  >
                    Clear
                  </button>
                )}
              </span>
            </div>
            <div className="planning-body">
              <div className="planning-builder">
                <label className="field">
                  Plan date
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label className="field">
                  Plan period
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as typeof kind)}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </label>
                <label className="field">
                  Planning mode
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as typeof mode)}
                  >
                    <option value="priority">Priority list</option>
                    <option value="timeblock">Time blocks</option>
                  </select>
                </label>
                <button
                  className="primary"
                  disabled={busy || !date}
                  onClick={() => void generate()}
                >
                  <Sparkles size={15} /> Generate draft plan
                </button>
              </div>
              {plan && document && (
                <section
                  aria-label="Plan editor"
                  className={`plan-editor tone-${planTone(plan.status)}`}
                >
                  <header>
                    <span className="approval-kind" aria-hidden="true">
                      <CalendarRange size={16} />
                    </span>
                    <div>
                      <h3 className="capitalize">
                        {document.kind} plan · {document.date}
                      </h3>
                      <small>
                        {document.timezone} ·{" "}
                        {dirty ? "Unsaved edits" : "Saved"} · Acceptance never
                        moves task deadlines.
                      </small>
                    </div>
                    <span className="approval-status capitalize">
                      {plan.status}
                    </span>
                  </header>
                  {document.assumptions.length > 0 && (
                    <ul className="plan-assumptions">
                      {document.assumptions.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  )}
                  <ol className="plan-entries">
                    {document.entries.map((entry, i) => {
                      const t =
                          brief.priorities.find(
                            (t) => t.id === entry.task_id,
                          ) ??
                          brief.completed.find((t) => t.id === entry.task_id),
                        progress = plan.progress.find(
                          (p) => p.task_id === entry.task_id,
                        );
                      return (
                        <li
                          key={entry.task_id}
                          className={
                            progress?.missed || progress?.changed
                              ? "has-warning"
                              : ""
                          }
                        >
                          <span className="intel-rank">{i + 1}</span>
                          <div className="plan-entry-main">
                            <button
                              className="intel-title"
                              onClick={() => onOpen("task", entry.task_id)}
                            >
                              {t?.title ?? "Open referenced task"}
                            </button>
                            <small>
                              {entry.reason} · Current status:{" "}
                              {label(progress?.status ?? "unknown")}
                            </small>
                            {progress?.changed && (
                              <span className="plan-warning">
                                <TriangleAlert size={13} /> Changed since plan
                                generation; regenerate before accepting.
                              </span>
                            )}
                            {progress?.missed && (
                              <span className="plan-warning">
                                <TriangleAlert size={13} /> Planned block
                                elapsed; task is still incomplete.
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => openRecovery(entry.task_id)}
                                >
                                  Review missed plan task
                                </button>
                              </span>
                            )}
                            {document.mode === "timeblock" && (
                              <label className="field plan-time">
                                Start time ({document.timezone})
                                <input
                                  type="datetime-local"
                                  value={
                                    entry.start
                                      ? wall(entry.start, document.timezone)
                                      : ""
                                  }
                                  onChange={(e) => {
                                    try {
                                      const start = e.target.value
                                        ? Temporal.PlainDateTime.from(
                                            e.target.value,
                                          )
                                            .toZonedDateTime(
                                              document.timezone,
                                              { disambiguation: "reject" },
                                            )
                                            .toInstant()
                                            .toString()
                                        : null;
                                      if (start && !t?.estimated_minutes)
                                        throw new Error(
                                          "Add a task estimate first.",
                                        );
                                      const end = start
                                        ? Temporal.Instant.from(start)
                                            .add({
                                              minutes: t!.estimated_minutes!,
                                            })
                                            .toString()
                                        : null;
                                      editDoc({
                                        ...document,
                                        entries: document.entries.map((x, j) =>
                                          i === j ? { ...x, start, end } : x,
                                        ),
                                      });
                                    } catch (err) {
                                      onError(err);
                                    }
                                  }}
                                />
                              </label>
                            )}
                          </div>
                          <div className="plan-entry-tools">
                            <button
                              className="icon-button"
                              aria-label="Move earlier"
                              title="Move earlier"
                              disabled={i === 0}
                              onClick={() => {
                                const entries = [...document.entries];
                                [entries[i - 1], entries[i]] = [
                                  entries[i]!,
                                  entries[i - 1]!,
                                ];
                                editDoc({ ...document, entries });
                              }}
                            >
                              <ChevronUp size={16} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label="Remove from plan"
                              title="Remove from plan"
                              onClick={() =>
                                editDoc({
                                  ...document,
                                  entries: document.entries.filter(
                                    (_, j) => j !== i,
                                  ),
                                })
                              }
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                    {!document.entries.length && (
                      <li className="plan-empty">
                        No tasks in this plan. Regenerate to add some.
                      </li>
                    )}
                  </ol>
                  <div className="planning-actions">
                    <button
                      className="primary"
                      disabled={busy || plan.status === "discarded"}
                      onClick={() => void change("accept")}
                    >
                      <Check size={15} /> Accept reviewed plan
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || plan.status === "discarded"}
                      onClick={() => void change("edit")}
                    >
                      Save plan edits
                    </button>
                    <button
                      className="text-button approval-cancel"
                      disabled={busy || plan.status === "discarded"}
                      onClick={() => void change("discard")}
                    >
                      Discard plan
                    </button>
                  </div>
                </section>
              )}
            </div>
          </section>
          <section className="panel" aria-labelledby="inbox-heading">
            <div className="section-title">
              <div>
                <span className="eyebrow">RANKED FOR YOU</span>
                <h2 id="inbox-heading">Prioritised inbox</h2>
              </div>
              <span className="planning-selected">
                {brief.priorities.length} active
              </span>
            </div>
            <p className="planning-intro">
              Select tasks for a plan, or leave selection empty to use up to the
              first 100 priorities. Missing estimates stay unscheduled. Open a
              task to change its priority or estimate.
            </p>
            <div className="planning-tasks">
              {brief.priorities.slice(page * 30, page * 30 + 30).map((t) => {
                const overdue = brief.overdue.some((o) => o.id === t.id),
                  checked = selected.includes(t.id);
                return (
                  <article
                    key={t.id}
                    className={`planning-task ${overdue ? "is-overdue" : ""} ${checked ? "is-selected" : ""}`}
                  >
                    <label className="planning-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setSelected((old) =>
                            e.target.checked
                              ? [...old, t.id]
                              : old.filter((id) => id !== t.id),
                          )
                        }
                      />
                      <span>
                        <span className="sr-only">Select </span>
                        {t.title}
                      </span>
                    </label>
                    <div className="planning-meta">
                      {t.priority !== "normal" && (
                        <span className={`priority ${t.priority}`}>
                          {t.priority}
                        </span>
                      )}
                      <span className="capitalize">{label(t.status)}</span>
                      <span className={overdue ? "is-late" : ""}>
                        <CalendarClock size={13} /> {showTime(t.due_at)}
                      </span>
                      <span>
                        <Clock3 size={13} />{" "}
                        {t.estimated_minutes === null
                          ? "Estimate missing"
                          : `${t.estimated_minutes} minutes`}
                      </span>
                    </div>
                    {t.reasons.length > 0 && (
                      <div className="planning-tags">
                        {t.reasons.map((r) => (
                          <span key={r}>{r}</span>
                        ))}
                      </div>
                    )}
                    <div className="planning-task-actions">
                      {overdue && (
                        <button
                          className="text-button tone-amber"
                          disabled={busy}
                          onClick={() => openRecovery(t.id)}
                        >
                          <CalendarClock size={13} /> Review rescheduling
                        </button>
                      )}
                      <button
                        className="text-button"
                        onClick={() => onOpen("task", t.id)}
                      >
                        <ExternalLink size={13} /> Open task
                      </button>
                      <button
                        className="text-button muted-button"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await api(
                              "/intelligence/feedback",
                              send({ task_id: t.id, kind: "not_useful" }),
                            );
                            setNotice(
                              "Feedback saved. Your task and priority are unchanged.",
                            );
                          })
                        }
                      >
                        <ThumbsDown size={13} /> Not useful
                      </button>
                      {t.priority !== "critical" && !overdue && (
                        <button
                          className="text-button muted-button"
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await api(
                                "/intelligence/feedback",
                                send({ task_id: t.id, kind: "dismissed" }),
                              );
                              await refresh();
                            })
                          }
                        >
                          <X size={13} /> Dismiss suggestion
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
              {!brief.priorities.length && (
                <div className="approvals-empty">
                  <Flame size={22} />
                  <strong>No active priorities.</strong>
                  <span>Add a task to start planning.</span>
                </div>
              )}
            </div>
            {brief.priorities.length > 30 && (
              <div className="pagination planning-pagination">
                <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous priorities
                </button>
                <span>Page {page + 1}</span>
                <button
                  disabled={(page + 1) * 30 >= brief.priorities.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next priorities
                </button>
              </div>
            )}
          </section>
        </div>
        <aside className="planning-column planning-side">
          <section className="panel" aria-labelledby="ai-recs-heading">
            <div className="section-title">
              <div>
                <span className="eyebrow">OPTIONAL · USES AI</span>
                <h2 id="ai-recs-heading">Planning recommendations</h2>
              </div>
              <span className="approval-kind tone-violet" aria-hidden="true">
                <Lightbulb size={16} />
              </span>
            </div>
            <div className="planning-body">
              <p className="muted planning-small">
                AI suggestions are not confirmed facts or completed actions.
                Ranking and time checks are deterministic.
              </p>
              <label className="field">
                Relevant ordinary memory search (optional)
                <input
                  value={memory}
                  maxLength={100}
                  placeholder="e.g. focus habits"
                  onChange={(e) => setMemory(e.target.value)}
                />
              </label>
              <label className="planning-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Allow sharing up to 20 task summaries and five matching ordinary
                global memories with my configured AI provider. This uses quota.
              </label>
              <button
                className="primary planning-wide"
                disabled={!consent || busy}
                onClick={() =>
                  void perform(async () => {
                    const result = await api<Briefing>(
                      "/intelligence/refresh",
                      send({
                        idempotency_key: crypto.randomUUID(),
                        consent: true,
                        memory_query: memory,
                      }),
                    );
                    setBrief(result);
                    setNotice(
                      result.ai_status === "completed"
                        ? "AI suggestions refreshed. Review them before using."
                        : `AI generation ${result.ai_status}; saved facts and plans remain available.`,
                    );
                  })
                }
              >
                <Sparkles size={15} /> Request AI suggestions
              </button>
              {brief.recommendations.length > 0 && (
                <ul className="planning-recs">
                  {brief.recommendations.map((r) => (
                    <li key={r.task_id}>
                      <button
                        className="intel-title"
                        onClick={() => onOpen("task", r.task_id)}
                      >
                        {titleOf(r.task_id) ?? "Open task"}
                      </button>
                      <small>Suggested: {r.advice}</small>
                    </li>
                  ))}
                </ul>
              )}
              {brief.recommendations.length > 0 && (
                <button
                  className="secondary planning-wide"
                  onClick={() =>
                    setSelected(brief.recommendations.map((r) => r.task_id))
                  }
                >
                  Use suggested tasks for next draft
                </button>
              )}
            </div>
          </section>
          <section className="panel" aria-labelledby="history-heading">
            <div className="section-title">
              <div>
                <span className="eyebrow">ARCHIVE</span>
                <h2 id="history-heading">Plan history</h2>
              </div>
            </div>
            <div className="planning-body">
              <ul className="plan-history">
                {history.map((p) => (
                  <li key={p.id}>
                    <button
                      aria-label={`${p.document.kind} · ${p.document.date} · ${p.status}`}
                      className={`tone-${planTone(p.status)} ${plan?.id === p.id ? "selected" : ""}`}
                      onClick={() => {
                        if (
                          dirty &&
                          !window.confirm("Discard unsaved plan edits?")
                        )
                          return;
                        void perform(async () =>
                          choose(await api<PlanDetail>(`/plans/${p.id}`)),
                        );
                      }}
                    >
                      <CalendarRange size={15} />
                      <span>
                        <strong className="capitalize">
                          {p.document.kind}
                        </strong>
                        <small>{p.document.date}</small>
                      </span>
                      <span className="approval-status capitalize">
                        {p.status}
                      </span>
                    </button>
                  </li>
                ))}
                {!history.length && (
                  <li className="plan-empty">
                    Generated plans will appear here.
                  </li>
                )}
              </ul>
              {(historyOffset > 0 || more) && (
                <div className="pagination planning-pagination">
                  <button
                    disabled={historyOffset === 0}
                    onClick={() => setHistoryOffset(historyOffset - 20)}
                  >
                    Previous plans
                  </button>
                  <button
                    disabled={!more}
                    onClick={() => setHistoryOffset(historyOffset + 20)}
                  >
                    Next plans
                  </button>
                </div>
              )}
            </div>
          </section>
          {prefs && (
            <section className="panel" aria-labelledby="prefs-heading">
              <div className="section-title">
                <div>
                  <span className="eyebrow">PREFERENCES</span>
                  <h2 id="prefs-heading">Availability and proactive alerts</h2>
                </div>
              </div>
              <div className="planning-body">
                <p className="muted planning-small">
                  Only the availability you enter is used. Focus blocks and
                  accepted plans reserve time. Notifications also respect quiet
                  hours and enabled channels.
                </p>
                <div className="planning-windows">
                  {prefs.value.windows.map((w, i) => (
                    <div className="planning-window" key={i}>
                      <label className="field">
                        Day
                        <select
                          value={w.day}
                          onChange={(e) =>
                            updateWindow(i, { day: Number(e.target.value) })
                          }
                        >
                          {days.map((d, k) => (
                            <option key={d} value={k + 1}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Available from
                        <input
                          type="time"
                          value={w.start}
                          onChange={(e) =>
                            updateWindow(i, { start: e.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        Available until
                        <input
                          type="time"
                          value={w.end}
                          onChange={(e) =>
                            updateWindow(i, { end: e.target.value })
                          }
                        />
                      </label>
                      <button
                        className="icon-button"
                        aria-label="Remove window"
                        title="Remove window"
                        onClick={() =>
                          updatePrefs({
                            windows: prefs.value.windows.filter(
                              (_, j) => j !== i,
                            ),
                          })
                        }
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  {!prefs.value.windows.length && (
                    <p className="plan-empty">No availability saved yet.</p>
                  )}
                </div>
                <button
                  className="add-row planning-add"
                  onClick={() =>
                    updatePrefs({
                      windows: [
                        ...prefs.value.windows,
                        { day: 1, start: "09:00", end: "17:00" },
                      ],
                    })
                  }
                >
                  <Plus size={15} /> Add availability window
                </button>
                <p className="help planning-help">
                  New windows are editable proposals; save only the hours you
                  are actually available.
                </p>
                <div className="planning-fields">
                  <label className="field">
                    Week starts
                    <select
                      value={prefs.value.first_day}
                      onChange={(e) =>
                        updatePrefs({ first_day: Number(e.target.value) })
                      }
                    >
                      {days.map((d, i) => (
                        <option key={d} value={i + 1}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Buffer minutes
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={prefs.value.buffer_minutes}
                      onChange={(e) =>
                        updatePrefs({ buffer_minutes: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="field">
                    Deadline lead time (minutes)
                    <input
                      type="number"
                      min={5}
                      max={10080}
                      value={prefs.value.lead_minutes}
                      onChange={(e) =>
                        updatePrefs({ lead_minutes: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="field">
                    Daily briefing alert time (leave blank to disable)
                    <input
                      type="time"
                      value={prefs.value.briefing_time ?? ""}
                      onChange={(e) =>
                        updatePrefs({ briefing_time: e.target.value || null })
                      }
                    />
                  </label>
                </div>
                <label className="planning-toggle">
                  <input
                    type="checkbox"
                    checked={prefs.value.alerts_enabled}
                    onChange={(e) =>
                      updatePrefs({ alerts_enabled: e.target.checked })
                    }
                  />
                  Enable optional personal planning alerts through my configured
                  notification channels (maximum five per local day).
                </label>
                <button
                  className="primary planning-wide"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      setPrefs(
                        await api("/planning-preferences", send(prefs, "PUT")),
                      );
                      setNotice("Planning preferences saved.");
                    })
                  }
                >
                  <Check size={15} /> Save planning preferences
                </button>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
