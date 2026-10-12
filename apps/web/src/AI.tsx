import { useEffect, useState } from "react";
import { api } from "./api";

type Config = {
  provider: string;
  model: string;
  validation_status: string;
  validated_at: string | null;
  key_configured: boolean;
};
type Provider = { id: string; name: string; models: string[] };
type History = {
  messages: {
    id: string;
    role: string;
    content: string;
    model: string | null;
    request_id: string;
  }[];
  requests: {
    id: string;
    status: string;
    error_code: string | null;
    retryable: boolean;
    attempts: number;
    include_context: boolean;
  }[];
};
const errors: Record<string, string> = {
  credentials: "Key rejected. Replace it in AI Settings.",
  quota: "Provider quota exhausted.",
  rate_limit: "Provider rate limit reached. Wait before retrying.",
  model: "Model unavailable. Check AI Settings.",
  rejected: "Provider rejected this request.",
  timeout:
    "Provider outcome unknown after timeout. This request will not be resent.",
  network: "Connection failed; provider outcome unknown.",
  outage: "Provider unavailable; outcome may be unknown.",
  malformed: "Provider returned an unusable response.",
};
export function AISettings({ onError }: { onError: (error: unknown) => void }) {
  const [registry, setRegistry] = useState<Provider[]>([]),
    [enabled, setEnabled] = useState(false),
    [config, setConfig] = useState<Config | null>(null);
  const [provider, setProvider] = useState("groq"),
    [model, setModel] = useState("llama-3.1-8b-instant"),
    [key, setKey] = useState("");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [consent, setConsent] = useState(false);
  const load = async () => {
    const result = await api<{ config: Config | null }>("/ai/config");
    setConfig(result.config);
    if (result.config) {
      setProvider(result.config.provider);
      setModel(result.config.model);
    }
  };
  useEffect(() => {
    void Promise.all([
      load(),
      api<{ enabled: boolean; providers: Provider[] }>("/ai/providers").then(
        (r) => {
          setRegistry(r.providers);
          setEnabled(r.enabled);
        },
      ),
    ]).catch(onError);
  }, [onError]);
  async function perform(action: "save" | "test" | "saved" | "delete") {
    setBusy(true);
    setNotice("");
    try {
      if (action === "delete") {
        await api("/ai/config", { method: "DELETE" });
        setKey("");
        setNotice(
          "Stored key deleted. Revoke it separately with the provider if needed.",
        );
      } else if (action === "save") {
        await api("/ai/config", {
          method: "PUT",
          body: JSON.stringify({
            provider,
            model,
            ...(key ? { apiKey: key } : {}),
          }),
        });
        setKey("");
        setNotice(
          "Saved securely. Test saved connection to verify these settings.",
        );
      } else {
        const result = await api<{ message: string }>("/ai/test", {
          method: "POST",
          body: JSON.stringify(
            action === "saved"
              ? { consent: true }
              : { provider, model, apiKey: key, consent: true },
          ),
        });
        setNotice(result.message);
      }
      if (action !== "test") await load();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel ai-panel">
      <h2>Your AI connection</h2>
      <p>
        Bring your own key. Requests go through AXIS to your selected provider;
        your provider’s usage limits and charges apply.
      </p>
      {!enabled && (
        <p role="status">
          AI is disabled until the server encryption key is configured. Tasks
          and reminders remain available.
        </p>
      )}
      <p>
        {config
          ? `API key configured · ${config.provider} · ${config.model} · ${config.validation_status}`
          : "No API key configured"}
      </p>
      {config?.validated_at && (
        <p>Last test: {new Date(config.validated_at).toLocaleString()}</p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform("save");
        }}
      >
        <label>
          AI provider
          <select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value);
              setModel(
                registry.find((p) => p.id === event.target.value)!.models[0]!,
              );
              setKey("");
            }}
          >
            {registry.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          AI model
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            {registry
              .find((p) => p.id === provider)
              ?.models.map((m) => (
                <option key={m}>{m}</option>
              ))}
          </select>
        </label>
        <small>
          Maintained model list. Availability depends on your provider account;
          no automatic fallback.
        </small>
        <label>
          Provider API key
          <input
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            maxLength={512}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={
              config
                ? "Leave blank to keep saved key"
                : "Enter your personal key"
            }
          />
        </label>
        <div className="ai-actions">
          <button
            className="primary"
            disabled={busy || !enabled || (!key && !config)}
          >
            Save AI settings
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || !config}
            onClick={() => void perform("delete")}
          >
            Delete stored key
          </button>
        </div>
        <label className="ai-checkbox">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          Allow a small test request to this provider (may use quota).
        </label>
        <div className="ai-actions">
          <button
            className="secondary"
            type="button"
            disabled={busy || !enabled || !key || !consent}
            onClick={() => void perform("test")}
          >
            Test entered key
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy || !enabled || !config || !consent}
            onClick={() => void perform("saved")}
          >
            Test saved connection
          </button>
        </div>
      </form>
      <p role="status" aria-live="polite">
        {busy ? "Working…" : notice}
      </p>
      <small>
        Deleting removes AXIS’s stored copy. It does not revoke the provider key
        or recall a request already started. Never paste keys into chat.
      </small>
    </section>
  );
}

export function AIChat({ onError }: { onError: (error: unknown) => void }) {
  const [conversations, setConversations] = useState<
      { id: string; title: string }[]
    >([]),
    [id, setId] = useState<string>();
  const [history, setHistory] = useState<History>({
      messages: [],
      requests: [],
    }),
    [message, setMessage] = useState(""),
    [context, setContext] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState<{
    request_id: string;
    conversation_id?: string;
    message: string;
    include_context: boolean;
    consent: true;
  }>();
  const list = async () =>
    setConversations(
      (
        await api<{ items: { id: string; title: string }[] }>(
          "/ai/conversations",
        )
      ).items,
    );
  useEffect(() => {
    void list().catch(onError);
  }, [onError]);
  function restore(result: History, conversation: string) {
    setHistory(result);
    setId(conversation);
    const last = result.requests[0],
      message = result.messages.find(
        (m) => m.role === "user" && m.request_id === last?.id,
      );
    setPending(
      last && last.status !== "succeeded" && message
        ? {
            request_id: last.id,
            conversation_id: conversation,
            message: message.content,
            include_context: last.include_context,
            consent: true,
          }
        : undefined,
    );
  }
  const open = async (conversation: string) => {
    setBusy(true);
    try {
      const result = await api<History>(`/ai/conversations/${conversation}`);
      restore(result, conversation);
      setNotice("");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  async function check() {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await api<History & { conversation_id: string }>(
        `/ai/requests/${pending.request_id}`,
      );
      restore(result, result.conversation_id);
      setNotice("Status refreshed. No provider request was sent.");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  async function send(retry = false) {
    setBusy(true);
    setNotice("");
    const payload = pending || {
      request_id: crypto.randomUUID(),
      conversation_id: id,
      message,
      include_context: context,
      consent: true as const,
    };
    setPending(payload);
    try {
      const result = await api<History & { conversation_id: string }>(
        "/ai/chat",
        { method: "POST", body: JSON.stringify({ ...payload, retry }) },
      );
      setHistory(result);
      setId(result.conversation_id);
      setMessage("");
      await list();
      const request = result.requests.find((r) => r.id === payload.request_id);
      if (request?.status === "pending")
        setNotice(
          "Request pending. Check status; checking does not resend it.",
        );
      else if (request?.status === "succeeded") setPending(undefined);
      else
        setNotice(
          errors[request?.error_code || ""] ||
            "Request could not be completed.",
        );
    } catch (error) {
      onError(error);
      setNotice(
        "Response not received. Check request status using the same request ID before sending another message.",
      );
    } finally {
      setBusy(false);
    }
  }
  const latest = history.requests[0];
  return (
    <section className="panel ai-panel">
      <h2>Chat with AXIS</h2>
      <p>
        Responses are AI-generated and unverified. Chat cannot change records or
        execute actions. Sending shares this conversation’s recent messages with
        your configured provider and may use paid quota.
      </p>
      <div className="ai-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setId(undefined);
            setHistory({ messages: [], requests: [] });
            setMessage("");
            setPending(undefined);
            setNotice("");
          }}
        >
          New conversation
        </button>
        <label>
          Conversation
          <select
            disabled={busy}
            value={id || ""}
            onChange={(event) => {
              if (event.target.value) void open(event.target.value);
            }}
          >
            <option value="">New conversation</option>
            {conversations.map((c) => (
              <option value={c.id} key={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        {id && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void open(id)}
          >
            Refresh history
          </button>
        )}
      </div>
      <div className="ai-messages" aria-label="Conversation messages">
        {history.messages.map((m) => (
          <article key={m.id} className={`ai-message ${m.role}`}>
            <strong>
              {m.role === "user" ? "You" : `AXIS · ${m.model || "AI"}`}
            </strong>
            <p>{m.content}</p>
          </article>
        ))}
      </div>
      {latest && latest.status !== "succeeded" && (
        <p role="status">
          {latest.status}:{" "}
          {errors[latest.error_code || ""] || "Waiting for a response."}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label>
          Message
          <textarea
            maxLength={4000}
            value={message}
            disabled={busy || Boolean(pending)}
            onChange={(event) => setMessage(event.target.value)}
            required
          />
        </label>
        <label className="ai-checkbox">
          <input
            type="checkbox"
            checked={context}
            disabled={busy || Boolean(pending)}
            onChange={(event) => setContext(event.target.checked)}
          />
          Include relevant tasks, projects and ordinary memories. Sensitive
          memories are excluded.
        </label>
        <button
          className="primary"
          disabled={busy || !message.trim() || Boolean(pending)}
        >
          Send to provider
        </button>
      </form>
      {pending && (
        <div className="ai-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void check()}
          >
            Check request status
          </button>
          {latest?.retryable && latest.attempts < 3 && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void send(true)}
            >
              Retry failed request (uses quota)
            </button>
          )}
          <button
            className="secondary"
            disabled={busy || latest?.status === "pending"}
            onClick={() => {
              setPending(undefined);
              setMessage("");
              setNotice("");
            }}
          >
            Dismiss request
          </button>
        </div>
      )}
      <p role="status" aria-live="polite">
        {busy ? "Working…" : notice}
      </p>
    </section>
  );
}
