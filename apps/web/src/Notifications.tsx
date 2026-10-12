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
  whatsapp_configured: boolean;
  email_configured: boolean;
  whatsapp_from: string | null;
};
export function Notifications({ onError }: { onError: (e: unknown) => void }) {
  const [setup, setSetup] = useState<Setup | null>(null),
    [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [phone, setPhone] = useState(""),
    [link, setLink] = useState(""),
    [consent, setConsent] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<(DeliveryJob & {title?:string})[]>([]),
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
    setPhone(s.settings.whatsapp_destination || "");
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
          whatsapp_enabled: settings.whatsapp_enabled,
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
            ? "Simulation mode — no WhatsApp messages or emails are sent."
            : setup.sandbox
              ? "WhatsApp Sandbox — only joined participants can receive messages."
              : "Production WhatsApp sender"}
        </p>
        <p className="muted">
          WhatsApp:{" "}
          {setup.whatsapp_configured
            ? "Provider configured"
            : "Provider setup required"}
          . Email:{" "}
          {setup.email_configured
            ? "Provider configured"
            : "Provider setup required"}
          .
        </p>
        <h3>Your WhatsApp number</h3>
        <label>
          Phone number with country code
          <input
            type="tel"
            value={phone}
            placeholder="+919876543210"
            onChange={(e) => setPhone(e.target.value)}
            maxLength={40}
          />
        </label>
        <p className="help">
          First join the Sandbox using the join phrase shown in your Twilio
          console. Then send the private linking code below from this phone to{" "}
          {setup.whatsapp_from || "your configured WhatsApp sender"}. AXIS does
          not send a verification message.
        </p>
        <button
          className="secondary"
          disabled={busy || !setup.whatsapp_configured}
          onClick={() =>
            void perform(async () => {
              const r = await api<{ code: string }>(
                "/notification-settings/whatsapp/link",
                { method: "POST", body: JSON.stringify({ phone }) },
              );
              setLink(r.code);
            })
          }
        >
          Get linking code
        </button>{" "}
        <button
          className="secondary"
          disabled={busy || !settings.whatsapp_destination}
          onClick={() =>
            void perform(async () => {
              await api("/notification-settings/whatsapp", {
                method: "DELETE",
              });
              setLink("");
              setNotice("WhatsApp number removed.");
            })
          }
        >
          Remove number
        </button>
        {link && (
          <p role="status">
            Send this exact message within 10 minutes: <code>{link}</code>. Then
            refresh here. Keep this code private.
          </p>
        )}
        <p>
          Phone:{" "}
          {settings.whatsapp_verified_at
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
              checked={settings.whatsapp_enabled}
              disabled={!settings.whatsapp_verified_at}
              onChange={(e) =>
                setSettings({ ...settings, whatsapp_enabled: e.target.checked })
              }
            />{" "}
            Enable WhatsApp reminders
          </label>
          <p className="help">
            Send STOP to the configured WhatsApp sender to opt out. Re-link
            before enabling again. Free-form reminders require a recent incoming
            message; outside that window an approved template is required.
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
            Use email fallback when WhatsApp delivery is unconfirmed
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
            WhatsApp may arrive after the fallback email. Both outcomes stay
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
            busy || setup.mode !== "live" || !setup.settings.whatsapp_enabled
          }
          onClick={() => void testChannel("whatsapp")}
        >
          Send WhatsApp test
        </button>{" "}
        <button
          className="secondary"
          disabled={
            busy || setup.mode !== "live" || !setup.settings.email_enabled
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
          Accepted means the provider received the request. Delivered requires
          confirmation. Unknown is not proof of failure.
        </p>
        {history.length === 0 && <p>No channel deliveries yet.</p>}
        {history.map((job) => (
          <article key={job.id} className="notification-history-item">
            <h3>
              {job.channel === "whatsapp" ? "WhatsApp" : "Email"}
              {job.fallback_of ? " fallback" : ""} · {job.kind}
            </h3>
            <p>{job.title || "Requested channel test"}</p>
            {job.reminder_id && <a href={`/?view=reminders&reminder=${job.reminder_id}`}>Open related reminder</a>}
            <p>
              {job.status.replaceAll("_", " ")}
              {job.attention ? " — needs attention" : ""}
            </p>
            {job.delivered_at && <p className="help">Delivery confirmed: {new Date(job.delivered_at).toLocaleString()}</p>}
            {job.fallback_deadline_at && <p className="help">Fallback deadline: {new Date(job.fallback_deadline_at).toLocaleString()}</p>}
            <p className="help">
              {new Date(job.created_at).toLocaleString()} · {job.attempt_count}{" "}
              attempts
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
            {job.attention &&
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
