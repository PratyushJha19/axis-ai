import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import type {
  NotificationSettings,
  DeliveryJob,
  Channel,
} from "../../../packages/shared/src/notifications";

type Setup = {
  settings: NotificationSettings;
  email: string;
  email_verified: boolean;
  mode: "mock" | "live";
  sandbox: boolean;
  telegram_configured: boolean;
  email_configured: boolean;
  telegram_username: string | null;
  telegram_poll_healthy: boolean;
  telegram_transport?: "webhook" | "polling";
  telegram_commands_enabled?: boolean;
};
export function Notifications({
  onError,
  timezone,
}: {
  onError: (e: unknown) => void;
  timezone: string | null;
}) {
  const time = (value: string) =>
    new Intl.DateTimeFormat("en", {
      timeZone: timezone || "UTC",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  const [setup, setSetup] = useState<Setup | null>(null),
    [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [link, setLink] = useState(""),
    [consent, setConsent] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<(DeliveryJob & { title?: string })[]>(
      [],
    ),
    [offset, setOffset] = useState(0),
    [hasMore, setHasMore] = useState(false);
  const [details, setDetails] = useState<{
    job: DeliveryJob;
    attempts: {
      id: string;
      status: string;
      attempt_number: number;
      error_category: string | null;
    }[];
  } | null>(null);
  const load = useCallback(async () => {
    const [s, h] = await Promise.all([
      api<Setup>("/notification-settings"),
      api<{ items: DeliveryJob[]; hasMore: boolean }>(
        `/notifications?limit=20&offset=${offset}`,
      ),
    ]);
    setSetup(s);
    setSettings(s.settings);
    setHistory(h.items);
    setHasMore(h.hasMore);
  }, [offset]);
  useEffect(() => {
    void load().catch(onError);
  }, [load, onError]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await action();
      await load();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    await perform(async () => {
      await api("/notification-settings", {
        method: "PUT",
        body: JSON.stringify({
          telegram_enabled: settings.telegram_enabled,
          email_enabled: settings.email_enabled,
          fallback_enabled: settings.fallback_enabled,
          fallback_after_seconds: settings.fallback_after_seconds,
          revision: settings.revision,
          consent,
        }),
      });
      setConsent(false);
      setNotice("Notification preferences saved.");
    });
  }
  async function testChannel(channel: Channel) {
    await perform(async () => {
      await api("/notifications/test", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ channel, consent: true }),
      });
      setNotice(
        "Test queued. Check delivery history; queued does not mean delivered.",
      );
    });
  }
  if (!setup || !settings)
    return <p role="status">Loading notification settings…</p>;
  return (
    <div className="notification-settings">
      <section className="panel settings-panel">
        <h2>Notification channels</h2>
        <p>
          {setup.mode === "mock"
            ? "Simulation mode — no Telegram messages or emails are sent."
            : "Telegram notifications — email fallback is optional."}
        </p>
        <p className="muted">
          Telegram:{" "}
          {setup.telegram_configured
            ? "Provider configured"
            : "Provider setup required"}
          . Email:{" "}
          {setup.email_configured
            ? "Provider configured"
            : "Provider setup required"}
          .
        </p>
        <h3>Your Telegram account</h3>
        {setup.mode === "live" && setup.telegram_configured && (
          <p className="help">
            {setup.telegram_transport === "webhook"
              ? "Webhook mode: send /help to the linked bot to check command delivery. An idle connection does not indicate a failure."
              : setup.telegram_poll_healthy
                ? "Telegram connection is receiving updates."
                : "Waiting for Telegram polling. Start the worker and refresh; check its connection if this persists."}
          </p>
        )}
        <p className="help">
          Open @{setup.telegram_username || "your configured bot"} in Telegram.
          Request a private linking code below and send it to the bot in a
          private chat. The worker must be running. Linking does not enable
          sends until you save consent.
        </p>
        {setup.telegram_commands_enabled && (
          <p className="help">
            Linked private chats can request task/reminder commands and receive
            replies. Send /help. Changes require /confirm with the action ID;
            deletion stays in AXIS. Sending /stop revokes this access.
            Natural-language requests use your saved AI provider and may use its
            quota.
          </p>
        )}
        <button
          className="secondary"
          disabled={busy || !setup.telegram_configured}
          onClick={() =>
            void perform(async () => {
              const r = await api<{ code: string }>(
                "/notification-settings/telegram/link",
                { method: "POST", body: JSON.stringify({}) },
              );
              setLink(r.code);
            })
          }
        >
          Get linking code
        </button>{" "}
        <button
          className="secondary"
          disabled={busy || !settings.telegram_destination}
          onClick={() =>
            void perform(async () => {
              await api("/notification-settings/telegram", {
                method: "DELETE",
              });
              setLink("");
              setNotice("Telegram disconnected.");
            })
          }
        >
          Disconnect Telegram
        </button>
        {link && (
          <p role="status">
            Send this exact message within 10 minutes: <code>{link}</code>. Then
            refresh here. Keep this code private.
          </p>
        )}
        <p>
          Telegram:{" "}
          {settings.telegram_verified_at
            ? "Verified; choose whether to enable below."
            : "Not verified"}
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              setLink("");
            })
          }
        >
          Refresh channels and history
        </button>
        <form onSubmit={save}>
          <label>
            <input
              type="checkbox"
              checked={settings.telegram_enabled}
              disabled={!settings.telegram_verified_at}
              onChange={(e) =>
                setSettings({ ...settings, telegram_enabled: e.target.checked })
              }
            />{" "}
            Enable Telegram reminders
          </label>
          <p className="help">
            Send /stop to your Telegram bot to opt out. Link again before
            enabling. No phone number, template or public webhook URL is
            required.
          </p>
          <label>
            <input
              type="checkbox"
              checked={settings.email_enabled}
              disabled={!setup.email_verified}
              onChange={(e) =>
                setSettings({ ...settings, email_enabled: e.target.checked })
              }
            />{" "}
            Enable email to {setup.email}
          </label>
          {!setup.email_verified && (
            <p>Sign out and sign in again to verify this email address.</p>
          )}
          <label>
            <input
              type="checkbox"
              checked={settings.fallback_enabled}
              onChange={(e) =>
                setSettings({ ...settings, fallback_enabled: e.target.checked })
              }
            />{" "}
            Use optional email fallback when sending to Telegram is unconfirmed
          </label>
          <label>
            Fallback delay (seconds)
            <input
              type="number"
              min={30}
              max={86400}
              value={settings.fallback_after_seconds}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  fallback_after_seconds: Number(e.target.value),
                })
              }
            />
          </label>
          <p className="help">
            Telegram may arrive after the fallback email. Both outcomes stay
            visible. Quiet hours and focus blocks apply to both channels.
            Changing these settings blocks previously queued deliveries with
            older consent; review their history.
          </p>
          <label>
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            I authorize AXIS to send my reminders to these enabled, verified
            personal channels.
          </label>
          <button className="primary" disabled={busy || !consent}>
            Save notification preferences
          </button>
        </form>
        <h3>Test a saved channel</h3>
        <p>
          Each button requests one fixed test message to your saved destination.
          Provider charges may apply. Tests also respect quiet hours.
        </p>
        <button
          className="secondary"
          disabled={
            busy ||
            setup.mode !== "live" ||
            !setup.telegram_configured ||
            !setup.settings.telegram_enabled
          }
          onClick={() => void testChannel("telegram")}
        >
          Send Telegram test
        </button>{" "}
        <button
          className="secondary"
          disabled={
            busy ||
            setup.mode !== "live" ||
            !setup.email_configured ||
            !setup.settings.email_enabled
          }
          onClick={() => void testChannel("email")}
        >
          Send email test
        </button>
        {notice && <p role="status">{notice}</p>}
      </section>
      <section className="panel settings-panel">
        <h2>Delivery history</h2>
        <p className="help">
          Times shown in {timezone || "UTC — set your profile timezone"}.
        </p>
        <p className="help">
          Telegram sent means the bot API confirmed sending, not delivery or
          reading. Accepted means the provider received the request. Delivered
          requires confirmation. Unknown is not proof of failure.
        </p>
        {history.length === 0 && <p>No channel deliveries yet.</p>}
        {history.map((job) => (
          <article key={job.id} className="notification-history-item">
            <h3>
              {job.channel === "telegram" ? "Telegram" : "Email"}
              {job.fallback_of ? " fallback" : ""} · {job.kind}
            </h3>
            <p>{job.title || "Requested channel test"}</p>
            {job.reminder_id && (
              <a href={`/?view=reminders&reminder=${job.reminder_id}`}>
                Open related reminder
              </a>
            )}
            <p>
              {job.status.replaceAll("_", " ")}
              {job.attention ? " — needs attention" : ""}
            </p>
            {job.delivered_at && (
              <p className="help">
                Delivery confirmed: {time(job.delivered_at)}
              </p>
            )}
            {job.fallback_deadline_at && (
              <p className="help">
                Fallback deadline: {time(job.fallback_deadline_at)}
              </p>
            )}
            <p className="help">
              {time(job.created_at)} · {job.attempt_count} attempts
              {job.error_category
                ? ` · ${job.error_category.replaceAll("_", " ")}`
                : ""}
            </p>
            <button
              className="secondary"
              onClick={() =>
                void api<typeof details>(`/notifications/${job.id}`)
                  .then(setDetails)
                  .catch(onError)
              }
            >
              Delivery details
            </button>{" "}
            {job.channel !== "telegram" &&
              job.attention &&
              ["accepted", "sent", "unknown"].includes(job.status) && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await api(`/notifications/${job.id}/reconcile`, {
                        method: "POST",
                        body: "{}",
                      });
                      setNotice("Status check queued. No resend requested.");
                    })
                  }
                >
                  Check provider status
                </button>
              )}
          </article>
        ))}
        <button
          className="secondary"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          Previous notifications
        </button>{" "}
        <button
          className="secondary"
          disabled={!hasMore}
          onClick={() => setOffset(offset + 20)}
        >
          Next notifications
        </button>
        {details && (
          <section aria-label="Delivery details">
            <h3>Attempt details</h3>
            {details.attempts.map((a) => (
              <p key={a.id}>
                Attempt {a.attempt_number}: {a.status}{" "}
                {a.error_category ? `(${a.error_category})` : ""}
              </p>
            ))}
            {!details.attempts.length && (
              <p>No provider attempt has started.</p>
            )}
            <button className="secondary" onClick={() => setDetails(null)}>
              Close details
            </button>
          </section>
        )}
      </section>
    </div>
  );
}
