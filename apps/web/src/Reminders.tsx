import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  Profile,
  Task,
  Project,
} from "../../../packages/shared/src/contracts";
import type {
  Reminder,
  Attempt,
  Preferences,
  ReminderInput,
} from "../../../packages/shared/src/reminders";
import { api } from "./api";

type Page<T> = { items: T[]; hasMore: boolean };
type Health = {
  due: number;
  attention: number;
  unknown: number;
  lag_seconds: number;
  mode: string;
  worker: { healthy: boolean; last_seen_at: string | null };
};
const formatted = (value: string | null, zone: string) =>
  value
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: zone,
      }).format(new Date(value))
    : "—";
function wallInput(value: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (key: string) => parts.find((p) => p.type === key)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
const statusLabel = (r: Reminder) =>
  r.status === "sent"
    ? r.channel_policy === "mock_only"
      ? "Mock sent; delivery not confirmed"
      : "Delivery pending; see Notifications"
    : `${r.status.replaceAll("_", " ")}${r.status === "delivered" && r.channel_policy === "mock_only" ? " (simulated)" : ""}`;

export function Reminders({
  user,
  onError,
}: {
  user: Profile;
  onError: (e: unknown) => void;
}) {
  const [page, setPage] = useState<Page<Reminder>>({
    items: [],
    hasMore: false,
  });
  const [offset, setOffset] = useState(0),
    [health, setHealth] = useState<Health | null>(null);
  const [preferences, setPreferences] = useState<
    (Preferences & { version: number }) | null
  >(null);
  const [editor, setEditor] = useState<{
    row?: Reminder;
    snooze?: boolean;
  } | null>(null);
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]),
    [projects, setProjects] = useState<Project[]>([]);
  const zone = user.timezone || "UTC";
  const load = useCallback(async () => {
    try {
      const [p, h, prefs, tasks, projects] = await Promise.all([
        api<Page<Reminder>>(`/reminders?offset=${offset}`),
        api<Health>("/system/status"),
        api<Preferences & { version: number }>("/reminder-preferences"),
        api<Page<Task>>("/tasks?limit=100"),
        api<Page<Project>>("/projects?limit=100"),
      ]);
      setPage(p);
      setHealth(h);
      setPreferences(prefs);
      setTasks(tasks.items);
      setProjects(projects.items);
    } catch (e) {
      onError(e);
    }
  }, [offset, onError]);
  useEffect(() => {
    void load();
  }, [load]);
  const cancel = async (row: Reminder) => {
    if (
      !window.confirm(
        `Cancel “${row.title}” and its future repeats? A dispatch already started cannot be recalled.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/reminders/${row.id}/cancel`, {
        method: "POST",
        headers: { "If-Match": String(row.version) },
        body: "{}",
      });
      setNotice("Reminder cancelled.");
      await load();
    } catch (e) {
      onError(e);
      await load();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="reminder-workspace">
      <section className="panel reminder-panel">
        <h2>Durable reminders</h2>
        <p>
          {health?.mode === "live"
            ? "Uses your verified, enabled notification channels. Review channel delivery in Notifications."
            : "Mock delivery only. No WhatsApp messages or emails are sent."}
        </p>
        <p className="muted">
          Quiet hours and focus blocks defer all reminders. After downtime, one
          overdue occurrence is processed; missed repeats are counted and
          skipped.
        </p>
        {health && (
          <p role="status">
            Worker: {health.worker.healthy ? "healthy" : "offline or stale"} ·{" "}
            {health.due} due · {health.attention} need attention ·{" "}
            {health.unknown} unknown · queue lag{" "}
            {Math.round(health.lag_seconds)}s<br />
            Last heartbeat: {formatted(health.worker.last_seen_at, zone)}
          </p>
        )}
        <div className="reminder-actions">
          <button
            className="primary"
            disabled={!user.timezone}
            onClick={() => {
              setNotice("");
              setEditor({});
            }}
          >
            Add reminder
          </button>
          <button className="secondary" onClick={() => void load()}>
            Refresh reminders
          </button>
        </div>
        {!user.timezone && (
          <p role="alert">
            Set your timezone in Settings before scheduling reminders.
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </section>
      {editor && (
        <ReminderEditor
          key={`${editor.row?.id || "new"}-${editor.snooze}`}
          user={user}
          row={editor.row}
          snooze={editor.snooze}
          tasks={tasks}
          projects={projects}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            setNotice(health?.mode === "live" ? "Reminder saved. Delivery will use your enabled channels." : "Reminder saved in PostgreSQL. Delivery is simulated.");
            await load();
          }}
          onError={onError}
        />
      )}
      {page.items.length === 0 && (
        <section className="panel reminder-panel">
          <p>
            No reminders on this page. Add a reminder with an explicit time to
            get started.
          </p>
        </section>
      )}
      {page.items.map((row) => (
        <section
          className="panel reminder-panel"
          key={row.id}
          aria-label={`Reminder ${row.title}`}
        >
          <h3>{row.title}</h3>
          <p>{row.body}</p>
          <p>
            <strong>{statusLabel(row)}</strong>
            {row.attention && " · Needs attention"}
          </p>
          <dl className="reminder-details">
            <dt>Due</dt>
            <dd>
              {formatted(row.due_at, row.timezone)} · {row.timezone}
            </dd>
            <dt>Next attempt / snooze</dt>
            <dd>{formatted(row.next_attempt_at, row.timezone)}</dd>
            <dt>Last attempt</dt>
            <dd>{formatted(row.last_attempt_at, row.timezone)}</dd>
            <dt>Schedule</dt>
            <dd>
              {row.recurrence} · occurrence {row.occurrence} · skipped repeats{" "}
              {row.skipped_count}
            </dd>
            <dt>Links</dt>
            <dd>
              {tasks.find((t) => t.id === row.task_id)?.title ||
                (row.task_id ? "Linked task" : "No task")}{" "}
              ·{" "}
              {projects.find((p) => p.id === row.project_id)?.name ||
                (row.project_id ? "Linked project" : "No project")}
            </dd>
            <dt>Delivery policy</dt>
            <dd>
              {row.channel_policy === "mock_only"
                ? "Mock only · real channels and fallback unavailable"
                : "WhatsApp with configured email fallback"}
            </dd>
            {row.reason && (
              <>
                <dt>Last result</dt>
                <dd>{row.reason.replaceAll("_", " ")}</dd>
              </>
            )}
          </dl>
          {["scheduled", "snoozed", "failed"].includes(row.status) && (
            <div className="reminder-actions">
              <button className="secondary" onClick={() => setEditor({ row })}>
                Edit / reschedule
              </button>
              <button
                className="secondary"
                onClick={() => setEditor({ row, snooze: true })}
              >
                Snooze
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void cancel(row)}
              >
                Cancel reminder
              </button>
            </div>
          )}
          {["processing", "unknown", "sent"].includes(row.status) && (
            <p className="help">
              Dispatch has started. Changes are blocked until its outcome is
              reconciled. An unresolved outcome is never blindly resent.
            </p>
          )}
          <AttemptHistory
            key={`${row.id}-${row.version}`}
            reminder={row.id}
            zone={row.timezone}
            onError={onError}
          />
          {row.attention && ["unknown", "sent"].includes(row.status) && (
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/reminders/${row.id}/reconcile`, {
                    method: "POST",
                    headers: { "If-Match": String(row.version) },
                    body: "{}",
                  });
                  setNotice("Reconciliation queued. No blind resend.");
                  await load();
                } catch (e) {
                  onError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reconcile status again
            </button>
          )}
        </section>
      ))}
      <div className="pagination">
        <button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >
          Previous
        </button>
        <span>Page {Math.floor(offset / 30) + 1}</span>
        <button disabled={!page.hasMore} onClick={() => setOffset(offset + 30)}>
          Next
        </button>
      </div>
      {preferences && (
        <QuietSettings
          key={preferences.version}
          preferences={preferences}
          zone={zone}
          enabled={Boolean(user.timezone)}
          onSaved={async () => {
            await load();
            setNotice("Reminder preferences saved.");
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function ReminderEditor({
  user,
  row,
  snooze,
  tasks,
  projects,
  onClose,
  onSaved,
  onError,
}: {
  user: Profile;
  row?: Reminder;
  snooze?: boolean;
  tasks: Task[];
  projects: Project[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [preview, setPreview] = useState<{
      input: ReminderInput;
      due_at: string;
      channel_policy: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const zone = user.timezone!;
  const prepare = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const data = new FormData(e.currentTarget);
    const input = {
      title: String(data.get("title") || row?.title || ""),
      body: String(data.get("body") ?? row?.body ?? ""),
      local_due: String(data.get("local_due")),
      timezone: zone,
      disambiguation: String(data.get("disambiguation")),
      recurrence: String(data.get("recurrence") || row?.recurrence || "none"),
      task_id: data.get("task_id") || null,
      project_id: data.get("project_id") || null,
      confirmed: true,
    } as ReminderInput;
    try {
      const result = await api<{ due_at: string; channel_policy: string }>(
        "/reminders/preview",
        {
          method: "POST",
          body: JSON.stringify({
            local_due: input.local_due,
            timezone: zone,
            disambiguation: input.disambiguation,
          }),
        },
      );
      setPreview({
        input,
        due_at: result.due_at,
        channel_policy: result.channel_policy,
      });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await api(
        row ? `/reminders/${row.id}${snooze ? "/snooze" : ""}` : "/reminders",
        {
          method: row && !snooze ? "PATCH" : "POST",
          headers: row
            ? { "If-Match": String(row.version) }
            : { "Idempotency-Key": key },
          body: JSON.stringify(
            snooze
              ? {
                  local_due: preview.input.local_due,
                  timezone: zone,
                  disambiguation: preview.input.disambiguation,
                }
              : preview.input,
          ),
        },
      );
      await onSaved();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel reminder-panel" aria-label="Reminder editor">
      <h2>
        {snooze ? "Snooze reminder" : row ? "Edit reminder" : "New reminder"}
      </h2>
      <form onSubmit={prepare} onChange={() => setPreview(null)}>
        {!snooze && (
          <>
            <label>
              Reminder title
              <input
                name="title"
                defaultValue={row?.title}
                required
                maxLength={200}
                autoFocus
              />
            </label>
            <label>
              Notification body
              <textarea name="body" defaultValue={row?.body} maxLength={1000} />
            </label>
            <p className="help">
              Keep notification text minimal; avoid sensitive personal
              information.
            </p>
          </>
        )}
        <label>
          {snooze ? "Snooze until" : "Reminder time"} ({zone})
          <input
            name="local_due"
            type="datetime-local"
            required
            defaultValue={row && !snooze ? wallInput(row.due_at, zone) : ""}
          />
        </label>
        <label>
          DST interpretation
          <select
            name="disambiguation"
            defaultValue={row?.disambiguation || "reject"}
          >
            <option value="reject">Ask if ambiguous or nonexistent</option>
            <option value="earlier">Earlier instant at DST transition</option>
            <option value="later">Later instant at DST transition</option>
          </select>
        </label>
        {!snooze && (
          <>
            <label>
              Repeat
              <select
                name="recurrence"
                defaultValue={row?.recurrence || "none"}
              >
                <option value="none">Once</option>
                <option value="daily">Daily at this local time</option>
                <option value="weekly">Weekly at this local time</option>
              </select>
            </label>
            <label>
              Linked task
              <select name="task_id" defaultValue={row?.task_id || ""}>
                <option value="">No task</option>
                {row?.task_id && !tasks.some((t) => t.id === row.task_id) && (
                  <option value={row.task_id}>Current linked task</option>
                )}
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Linked project
              <select name="project_id" defaultValue={row?.project_id || ""}>
                <option value="">No project</option>
                {row?.project_id &&
                  !projects.some((p) => p.id === row.project_id) && (
                    <option value={row.project_id}>
                      Current linked project
                    </option>
                  )}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="help">
              Link pickers show the first 100 active records. For deadline
              offsets, choose the exact reminder time before/on/after the task
              deadline; task dates are not moved.
            </p>
          </>
        )}
        <p className="help">
          Recurring schedules retain this wall-clock time and timezone.
          Ambiguous future occurrences pause for review unless you explicitly
          select earlier/later. Snoozing changes only this occurrence's next
          attempt.
        </p>
        <div className="reminder-actions">
          <button className="primary" disabled={busy} type="submit">
            Preview schedule
          </button>
          <button className="secondary" type="button" onClick={onClose}>
            Close editor
          </button>
        </div>
      </form>
      {preview && (
        <div className="reminder-confirm" role="status">
          <h3>Confirm schedule</h3>
          <p>{preview.input.title}</p>
          <p>
            {formatted(preview.due_at, zone)} · {zone}
            <br />
            UTC: {preview.due_at}
          </p>
          <p>
            {snooze
              ? "Snooze this occurrence"
              : `Repeat: ${preview.input.recurrence}`}{" "}
            ·{" "}
            {preview.channel_policy === "whatsapp_email"
              ? "Your enabled notification channels"
              : "Mock only, no real message"}
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void save()}
          >
            Confirm {snooze ? "snooze" : "reminder"}
          </button>
        </div>
      )}
    </section>
  );
}
function AttemptHistory({
  reminder,
  zone,
  onError,
}: {
  reminder: string;
  zone: string;
  onError: (e: unknown) => void;
}) {
  const [page, setPage] = useState<Page<Attempt> | null>(null),
    [offset, setOffset] = useState(0);
  const load = async (next = 0) => {
    try {
      setPage(
        await api<Page<Attempt>>(
          `/reminders/${reminder}/attempts?offset=${next}`,
        ),
      );
      setOffset(next);
    } catch (e) {
      onError(e);
    }
  };
  return (
    <div className="attempt-history">
      <button className="text-button" onClick={() => void load()}>
        View / refresh delivery attempts
      </button>
      {page && (
        <>
          <ul>
            {page.items.map((a) => (
              <li key={a.id}>
                Occurrence {a.occurrence} · attempt {a.attempt_number}:{" "}
                <strong>
                  {a.status} ({a.channel})
                </strong>{" "}
                · {formatted(a.started_at, zone)}
                {a.error_category &&
                  ` · ${a.error_category.replaceAll("_", " ")}`}
                {a.provider_message_id && (
                  <span className="help">
                    {" "}
                    · {a.channel === "mock" ? "Mock receipt" : "Provider reference"} {a.provider_message_id}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!page.items.length && <p>No delivery attempts yet.</p>}
          <button
            disabled={offset === 0}
            onClick={() => void load(Math.max(0, offset - 30))}
          >
            Earlier page
          </button>
          <button
            disabled={!page.hasMore}
            onClick={() => void load(offset + 30)}
          >
            More attempts
          </button>
        </>
      )}
    </div>
  );
}
function QuietSettings({
  preferences,
  zone,
  enabled,
  onSaved,
  onError,
}: {
  preferences: Preferences & { version: number };
  zone: string;
  enabled: boolean;
  onSaved: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [blocks, setBlocks] = useState(preferences.focus_blocks),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const convert = async (local: string) =>
    (
      await api<{ due_at: string }>("/reminders/preview", {
        method: "POST",
        body: JSON.stringify({
          local_due: local,
          timezone: zone,
          disambiguation: "reject",
        }),
      })
    ).due_at;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    try {
      let updated = blocks;
      if (data.get("focus_start") || data.get("focus_end"))
        updated = [
          ...blocks,
          {
            start: await convert(String(data.get("focus_start"))),
            end: await convert(String(data.get("focus_end"))),
          },
        ];
      await api("/reminder-preferences", {
        method: "PUT",
        headers: { "If-Match": String(preferences.version) },
        body: JSON.stringify({
          quiet_start: data.get("quiet_start") || null,
          quiet_end: data.get("quiet_end") || null,
          focus_blocks: updated,
        }),
      });
      setNotice("Reminder preferences saved.");
      await onSaved();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel reminder-panel">
      <h2>Quiet hours & focus blocks</h2>
      <p>
        Times use {zone}. All reminders wait until quiet/focus time ends; no
        urgent bypass. Clear both quiet fields to disable quiet hours. Focus
        blocks are internal reminder preferences, not calendar events.
      </p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Quiet hours start
            <input
              type="time"
              name="quiet_start"
              defaultValue={preferences.quiet_start || ""}
            />
          </label>
          <label>
            Quiet hours end
            <input
              type="time"
              name="quiet_end"
              defaultValue={preferences.quiet_end || ""}
            />
          </label>
        </div>
        <ul>
          {blocks.map((b, i) => (
            <li key={`${b.start}-${i}`}>
              {formatted(b.start, zone)} – {formatted(b.end, zone)}{" "}
              <button
                type="button"
                onClick={() => setBlocks(blocks.filter((_, n) => n !== i))}
              >
                Remove focus block
              </button>
            </li>
          ))}
        </ul>
        <div className="form-grid">
          <label>
            New focus start
            <input type="datetime-local" name="focus_start" />
          </label>
          <label>
            New focus end
            <input type="datetime-local" name="focus_end" />
          </label>
        </div>
        <p className="help">
          Focus times at an ambiguous DST transition must be changed to an
          unambiguous local time. Changes take effect when you save. Already
          deferred reminders keep their saved next attempt time.
        </p>
        <button className="primary" disabled={busy || !enabled}>
          Save reminder preferences
        </button>
        {notice && <p role="status">{notice}</p>}
      </form>
    </section>
  );
}
