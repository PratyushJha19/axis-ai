import { useCallback, useEffect, useState } from "react";
import {
  BellRing,
  Check,
  ChevronDown,
  CircleAlert,
  History,
  ListTodo,
  Play,
  RotateCw,
  ShieldCheck,
  X,
} from "lucide-react";
import type { ChatAction } from "../../../packages/shared/src/chat-actions";
import { api } from "./api";
import { timeUntil, useNow } from "./Engage";

type Approval = Omit<ChatAction, "status"> & {
  status: string;
  policy_version: string;
  failure_code: string | null;
};
type Filter = "all" | "review" | "ready" | "closed";
const filters: [Filter, string][] = [
  ["all", "All"],
  ["review", "Needs review"],
  ["ready", "Ready to run"],
  ["closed", "Closed"],
];
const inFilter = (item: Approval, filter: Filter) =>
  filter === "all" ||
  (filter === "review" && item.status === "pending") ||
  (filter === "ready" && item.status === "approved") ||
  (filter === "closed" && !["pending", "approved"].includes(item.status));
const statusLabel: Record<string, string> = {
  pending: "Needs review",
  approved: "Approved · ready to run",
  executing: "Running",
  executed: "Executed",
  rejected: "Rejected",
  expired: "Expired",
  cancelled: "Cancelled",
  failed: "Failed",
  unknown: "Outcome unknown",
};
const tone = (status: string) =>
  status === "pending"
    ? "review"
    : status === "approved"
      ? "ready"
      : status === "executed"
        ? "done"
        : ["failed", "unknown"].includes(status)
          ? "bad"
          : "muted";
const eventLabel = (type: string) =>
  type
    .replace(/^(chat_)?action_/, "")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
function schedule(local: string | null | undefined, zone: string | null) {
  if (!local) return "No due date";
  const [d, t] = local.split("T");
  const [y, m, day] = (d ?? "").split("-").map(Number);
  const [h, min] = (t ?? "").split(":").map(Number);
  const wall = new Date(Date.UTC(y!, m! - 1, day!, h, min));
  // Render the proposal's wall-clock time exactly as stored, not re-zoned.
  return `${new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(wall)}${zone ? ` · ${zone}` : ""}`;
}

export function Approvals({ onError }: { onError: (error: unknown) => void }) {
  const [items, setItems] = useState<Approval[]>([]),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [notice, setNotice] = useState(""),
    [filter, setFilter] = useState<Filter>("all");
  const [events, setEvents] = useState<
    Record<string, { event_type: string; created_at: string }[]>
  >({});
  const now = useNow();
  const refresh = useCallback(async () => {
    const result = await api<{ items: Approval[]; hasMore: boolean }>(
      `/approvals?offset=${offset}`,
    );
    const target = new URLSearchParams(window.location.search).get("proposal");
    if (offset === 0 && target && /^[a-f0-9-]{36}$/i.test(target)) {
      const selected = await api<Approval>(`/approvals/${target}`);
      setItems([
        selected,
        ...result.items.filter((item) => item.id !== target),
      ]);
    } else setItems(result.items);
    setMore(result.hasMore);
    setLoaded(true);
  }, [offset]);
  useEffect(() => {
    void refresh().catch(onError);
  }, [refresh, onError]);
  async function decide(item: Approval, operation: string) {
    setBusy(true);
    setNotice("");
    try {
      const result = await api<{ status: string }>(
        `/approvals/${item.id}/${operation}`,
        {
          method: "POST",
          body: JSON.stringify({ payload_hash: item.payload_hash }),
        },
      );
      setNotice(`Action ${result.status}.`);
      await refresh();
    } catch (error) {
      onError(error);
      await refresh().catch(onError);
    } finally {
      setBusy(false);
    }
  }
  function toggleHistory(item: Approval) {
    if (events[item.id]) {
      setEvents(({ [item.id]: _hidden, ...rest }) => rest);
      return;
    }
    void api<{ items: { event_type: string; created_at: string }[] }>(
      `/approvals/${item.id}/events`,
    )
      .then((result) =>
        setEvents((previous) => ({ ...previous, [item.id]: result.items })),
      )
      .catch(onError);
  }
  const counts = {
    review: items.filter((i) => i.status === "pending").length,
    ready: items.filter((i) => i.status === "approved").length,
  };
  const shown = items.filter((i) => inFilter(i, filter));
  return (
    <section className="approvals">
      <div className="approvals-bar">
        <div className="approvals-filters" role="group" aria-label="Filter">
          {filters.map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              className={filter === value ? "selected" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
              {value === "review" && counts.review > 0 && (
                <span className="approvals-count">{counts.review}</span>
              )}
              {value === "ready" && counts.ready > 0 && (
                <span className="approvals-count">{counts.ready}</span>
              )}
            </button>
          ))}
        </div>
        <button
          className="ai-icon-button"
          disabled={busy}
          aria-label="Refresh approvals"
          title="Refresh approvals"
          onClick={() => void refresh().catch(onError)}
        >
          <RotateCw size={16} />
        </button>
      </div>
      <details className="approvals-info">
        <summary>
          <ShieldCheck size={16} /> Nothing runs without your approval
          <ChevronDown size={14} className="approvals-chevron" />
        </summary>
        <ul>
          <li>
            Review the exact action, then approve it. Approval expires at the
            time shown.
          </li>
          <li>
            Approved actions wait for you to run them; nothing executes on its
            own.
          </li>
          <li>
            Only internal task and reminder creation is enabled. External and
            high-risk actions are unavailable.
          </li>
          <li>
            Reminder delivery still follows your channel consent and schedule.
          </li>
        </ul>
      </details>
      {notice && (
        <p role="status" className="approvals-notice">
          <Check size={15} /> {notice}
        </p>
      )}
      {loaded && !shown.length && (
        <div className="approvals-empty">
          <ShieldCheck size={22} />
          <strong>
            {filter === "review"
              ? "Nothing waiting for review."
              : filter === "ready"
                ? "Nothing approved and waiting to run."
                : filter === "closed"
                  ? "No closed actions on this page."
                  : "No approval proposals yet."}
          </strong>
          <span>When AXIS proposes an action in chat, it appears here.</span>
        </div>
      )}
      <div className="approvals-list">
        {shown.map((item) => {
          const payload = item.payload,
            reminder = payload.kind === "reminder",
            open = ["pending", "approved"].includes(item.status),
            expiry = timeUntil(item.expires_at, now),
            detail =
              payload.kind === "reminder" ? payload.body : payload.description;
          return (
            <article
              className={`approval-card tone-${tone(item.status)}`}
              key={item.id}
            >
              <header>
                <span className="approval-kind" aria-hidden="true">
                  {reminder ? <BellRing size={16} /> : <ListTodo size={16} />}
                </span>
                <h3>
                  {reminder ? "Create reminder" : "Create task"}:{" "}
                  {item.payload.title}
                </h3>
                <span className="approval-status">
                  <span className="sr-only">Status: </span>
                  <span className="approval-status-code">{item.status}</span>
                  <span aria-hidden="true">
                    {statusLabel[item.status] ?? item.status}
                  </span>
                </span>
              </header>
              {detail && <p className="approval-detail">{detail}</p>}
              <dl className="approval-facts">
                <div>
                  <dt>When</dt>
                  <dd>
                    {schedule(item.payload.local_due, item.payload.timezone)}
                  </dd>
                </div>
                {payload.kind === "reminder" && (
                  <div>
                    <dt>Repeats</dt>
                    <dd className="capitalize">{payload.recurrence}</dd>
                  </div>
                )}
                <div>
                  <dt>Destination</dt>
                  <dd>Your AXIS workspace · internal</dd>
                </div>
                {open && (
                  <div>
                    <dt>Expires</dt>
                    <dd className={`expiry expiry-${expiry.tone}`}>
                      {expiry.text} ·{" "}
                      {new Date(item.expires_at).toLocaleString()}
                    </dd>
                  </div>
                )}
              </dl>
              {item.failure_code && (
                <p role="alert" className="approval-alert">
                  <CircleAlert size={15} /> Execution failed:{" "}
                  {item.failure_code}. Request a new proposal.
                </p>
              )}
              {item.status === "unknown" && (
                <p className="approval-alert">
                  <CircleAlert size={15} /> Outcome unknown. Do not retry;
                  reconciliation is required.
                </p>
              )}
              {(open || item.status === "unknown") && (
                <div className="approval-actions">
                  {item.status === "pending" && (
                    <>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void decide(item, "approve")}
                      >
                        <Check size={15} /> Approve exact action
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void decide(item, "reject")}
                      >
                        <X size={15} /> Reject
                      </button>
                    </>
                  )}
                  {item.status === "approved" && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void decide(item, "execute")}
                    >
                      <Play size={15} /> Execute approved action
                    </button>
                  )}
                  {open && (
                    <button
                      className="text-button approval-cancel"
                      disabled={busy}
                      onClick={() => void decide(item, "cancel")}
                    >
                      Cancel action
                    </button>
                  )}
                </div>
              )}
              <footer>
                <button
                  className="text-button"
                  aria-expanded={Boolean(events[item.id])}
                  onClick={() => toggleHistory(item)}
                >
                  <History size={14} />
                  {events[item.id]
                    ? "Hide audit history"
                    : "View audit history"}
                </button>
                <details className="approval-tech">
                  <summary>Technical details</summary>
                  <dl>
                    <div>
                      <dt>Action ID</dt>
                      <dd>{item.id}</dd>
                    </div>
                    <div>
                      <dt>Policy</dt>
                      <dd>{item.policy_version}</dd>
                    </div>
                    <div>
                      <dt>Local time</dt>
                      <dd>
                        {item.payload.local_due || "None"}{" "}
                        {item.payload.timezone || ""}
                      </dd>
                    </div>
                    {item.payload.due_at && (
                      <div>
                        <dt>UTC</dt>
                        <dd>{item.payload.due_at}</dd>
                      </div>
                    )}
                  </dl>
                </details>
              </footer>
              {events[item.id] && (
                <ol className="approval-timeline">
                  {events[item.id]!.map((event, i) => (
                    <li key={i}>
                      <strong>{eventLabel(event.event_type)}</strong>
                      <code>{event.event_type}</code>
                      <time dateTime={event.created_at}>
                        {new Date(event.created_at).toLocaleString()}
                      </time>
                    </li>
                  ))}
                  {!events[item.id]!.length && <li>No events recorded.</li>}
                </ol>
              )}
            </article>
          );
        })}
      </div>
      {(offset > 0 || more) && (
        <div className="pagination">
          <button
            disabled={busy || offset === 0}
            onClick={() => setOffset(offset - 30)}
          >
            Previous
          </button>
          <span>Page {offset / 30 + 1}</span>
          <button
            disabled={busy || !more}
            onClick={() => setOffset(offset + 30)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
