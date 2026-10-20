import { useEffect, useState } from "react";
import {
  Check,
  CircleAlert,
  Info,
  Link2,
  RefreshCw,
  TriangleAlert,
  Unlink,
} from "lucide-react";
import { api } from "./api";
import type {
  CalendarEvent,
  CalendarView,
} from "../../../packages/shared/src/calendar";
const words = (value: string) => value.replaceAll("_", " ");
const statusTone = (status: string) =>
  status === "connected" ? "done" : status === "disconnected" ? "muted" : "bad";
// Plain YYYY-MM-DD labels are rendered without shifting through UTC.
const dayLabel = (day: string) =>
  new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const time = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
const localDay = (e: CalendarEvent) =>
  e.all_day
    ? e.start.slice(0, 10)
    : new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: e.timezone,
      }).format(new Date(e.start));
const groupByDay = (events: CalendarEvent[]) => {
  const days = new Map<string, CalendarEvent[]>();
  for (const e of events)
    days.set(localDay(e), [...(days.get(localDay(e)) ?? []), e]);
  return [...days.entries()];
};
export function Calendar({
  date,
  onError,
}: {
  date: string;
  onError: (e: unknown) => void;
}) {
  const [data, setData] = useState<CalendarView | null>(null),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [notice, setNotice] = useState(
      new URLSearchParams(window.location.search).get("calendar") === "failed"
        ? "Calendar connection failed or expired. Check the Google setup and choose the same account you use for AXIS, then try again."
        : "",
    );
  const load = () =>
    api<CalendarView>(
      `/calendar/events?date=${encodeURIComponent(date)}&days=14`,
    ).then(setData);
  useEffect(() => {
    if (date)
      void api<CalendarView>(
        `/calendar/events?date=${encodeURIComponent(date)}&days=14`,
      )
        .then(setData)
        .catch(onError);
  }, [date, onError]);
  async function act(kind: "connect" | "sync" | "disconnect") {
    setBusy(true);
    setNotice("");
    try {
      if (kind === "connect") {
        const r = await api<{ url: string }>("/calendar/connect", {
          method: "POST",
          body: JSON.stringify({ consent: true }),
        });
        window.location.assign(r.url);
        return;
      }
      if (kind === "sync")
        setData(
          await api<CalendarView>("/calendar/sync", {
            method: "POST",
            body: JSON.stringify({ date, days: 14 }),
          }),
        );
      else {
        const r = await api<{ remote_revocation: string }>(
          "/calendar/disconnect",
          { method: "POST", body: JSON.stringify({ confirmed: true }) },
        );
        setNotice(
          `Disconnected locally. Google revocation: ${r.remote_revocation}.`,
        );
        await load();
      }
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const connected = Boolean(data && data.status !== "disconnected");
  const consentBox = data && (
    <>
      <label className="planning-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        Allow read-only Calendar access through a separate Google consent
        screen.
      </label>
      <button
        className={connected ? "secondary" : "primary"}
        disabled={busy || !consent || !data.configured}
        onClick={() => void act("connect")}
      >
        <Link2 size={15} />
        {connected ? "Reconnect Google Calendar" : "Connect Google Calendar"}
      </button>
    </>
  );
  return (
    <section className="panel calendar-card" aria-label="Google Calendar">
      <div className="section-title">
        <div>
          <span className="eyebrow">READ-ONLY · GOOGLE</span>
          <h2>Google Calendar</h2>
        </div>
        {data && (
          <span
            className={`approval-status capitalize tone-${statusTone(data.status)}`}
          >
            {words(data.status)}
          </span>
        )}
      </div>
      <div className="planning-body">
        <p className="muted planning-small">
          Read-only access to your primary calendar. Connect the same Google
          account you use for AXIS. Titles and busy times support planning; AXIS
          cannot change Google events.
        </p>
        {!data ? (
          <p className="agent-empty">Loading Calendar…</p>
        ) : (
          <>
            <dl className="approval-facts">
              <div>
                <dt>Last refreshed</dt>
                <dd>
                  {data.last_sync
                    ? new Date(data.last_sync).toLocaleString()
                    : "Never"}
                </dd>
              </div>
              <div>
                <dt>Cached range</dt>
                <dd>
                  {data.range_start && data.range_end
                    ? `${dayLabel(data.range_start)} – ${dayLabel(data.range_end)}`
                    : "None yet"}
                </dd>
              </div>
              <div>
                <dt>Commitments</dt>
                <dd>{data.events.length}</dd>
              </div>
            </dl>
            {data.warning && (
              <p role="status" className="planning-note tone-amber">
                <TriangleAlert size={15} /> {data.warning}
              </p>
            )}
            {data.error_code && (
              <p role="alert" className="approval-alert">
                <CircleAlert size={15} /> Last refresh failed:{" "}
                {words(data.error_code)}.
              </p>
            )}
            {!data.configured && (
              <p className="planning-note tone-muted">
                <Info size={15} /> Operator setup needed: Google OAuth and
                server encryption configuration.
              </p>
            )}
            {!connected && <div className="calendar-connect">{consentBox}</div>}
            {connected && (
              <div className="planning-actions">
                <button
                  className="primary"
                  disabled={busy || !data.configured}
                  onClick={() => void act("sync")}
                >
                  <RefreshCw size={15} /> Refresh 14 days from {date}
                </button>
                <button
                  className="text-button approval-cancel"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Disconnect Calendar and delete its cached events? AXIS tasks and plans remain. Google revocation may affect other permissions granted to this OAuth client.",
                      )
                    )
                      void act("disconnect");
                  }}
                >
                  <Unlink size={13} /> Disconnect Calendar
                </button>
              </div>
            )}
            {connected && (
              <>
                <p className="help planning-help">
                  Real Google commitments for this range. Refresh the selected
                  planning dates before generating or accepting a plan. Proposed
                  AXIS blocks remain separate.
                </p>
                {data.events.length === 0 ? (
                  <p className="agent-empty">
                    No cached commitments in this range.
                  </p>
                ) : (
                  <div className="calendar-days">
                    {groupByDay(data.events).map(([day, events]) => (
                      <div className="calendar-day" key={day}>
                        <h3>{dayLabel(day)}</h3>
                        <ul>
                          {events.map((e) => (
                            <li
                              key={e.id}
                              className={e.busy ? "is-busy" : "is-free"}
                            >
                              <span className="calendar-time">
                                {e.all_day
                                  ? "All day"
                                  : `${time(e.start, e.timezone)} – ${time(e.end, e.timezone)}`}
                              </span>
                              <span className="calendar-event">
                                <strong>{e.title}</strong>
                                <small>{e.timezone}</small>
                              </span>
                              <span className="calendar-busy">
                                {e.busy ? "Busy" : "Available"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
                <details className="calendar-reconnect">
                  <summary>Reconnect or switch account</summary>
                  <div className="calendar-connect">{consentBox}</div>
                </details>
              </>
            )}
          </>
        )}
        {notice && (
          <p role="status" className="approvals-notice">
            <Check size={15} /> {notice}
          </p>
        )}
      </div>
    </section>
  );
}
