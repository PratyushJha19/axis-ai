import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Check, RotateCw, SquarePen } from "lucide-react";
import { api } from "./api";
import type { ChatAction } from "../../../packages/shared/src/chat-actions";

type Config = {
  provider: string;
  model: string;
  validation_status: string;
  validated_at: string | null;
  key_configured: boolean;
};
type Provider = { id: string; name: string; models: string[] };
type History = {
  actions?: ChatAction[];
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
  output_limit:
    "Output limit reached before a text answer. Increase the server token limit or choose another model.",
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
    [model, setModel] = useState(""),
    [key, setKey] = useState("");
  const [models, setModels] = useState<
    { id: string; restriction: string | null }[]
  >([]);
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
  async function perform(
    action: "save" | "test" | "saved" | "delete" | "models",
  ) {
    setBusy(true);
    setNotice("");
    try {
      if (action === "models") {
        const result = await api<{
          models: { id: string; restriction: string | null }[];
        }>("/ai/models", {
          method: "POST",
          body: JSON.stringify(key ? { apiKey: key } : {}),
        });
        setModels(result.models);
        setNotice(
          result.models.length
            ? "Model list loaded. Availability still depends on your Groq project permissions."
            : "Groq returned no active models. You can enter a text model ID manually.",
        );
        return;
      } else if (action === "delete") {
        await api("/ai/config", { method: "DELETE" });
        setKey("");
        setModels([]);
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
              setModel("");
              setModels([]);
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
          <input
            list="groq-models"
            required
            maxLength={200}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Load models below or enter a text model ID"
          />
          <datalist id="groq-models">
            {models
              .filter((m) => !m.restriction)
              .map((m) => (
                <option key={m.id} value={m.id} />
              ))}
          </datalist>
        </label>
        <small>
          Choose a loaded model or enter any Groq text-chat model ID. Audio
          models require a separate interface. No automatic fallback.
        </small>
        {models.some((m) => m.restriction) && (
          <details>
            <summary>Models requiring another interface</summary>
            <ul>
              {models
                .filter((m) => m.restriction)
                .map((m) => (
                  <li key={m.id}>
                    {m.id}: {m.restriction}
                  </li>
                ))}
            </ul>
          </details>
        )}
        <label>
          Provider API key
          <input
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            maxLength={512}
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setModels([]);
            }}
            placeholder={
              config
                ? "Leave blank to keep saved key"
                : "Enter your personal key"
            }
          />
        </label>
        <div className="ai-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy || !enabled || (!key && !config)}
            onClick={() => void perform("models")}
          >
            Load Groq models
          </button>
          <button
            className="primary"
            disabled={busy || !enabled || !model.trim() || (!key && !config)}
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
          Allow a small test request to this provider (up to 1,024 output
          tokens; may use quota).
        </label>
        <div className="ai-actions">
          <button
            className="secondary"
            type="button"
            disabled={busy || !enabled || !model.trim() || !key || !consent}
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

const suggestions = [
  "Remind me tomorrow at 9am to call the bank",
  "Add a task to review my budget this week",
  "Help me plan a focused afternoon",
];

export function AIChat({
  onError,
  compact = false,
  toolbar,
}: {
  onError: (error: unknown) => void;
  compact?: boolean;
  toolbar?: ReactNode;
}) {
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
  const thread = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [history, busy]);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [message]);
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
  async function decide(action: ChatAction, decision: "confirm" | "reject") {
    setBusy(true);
    setNotice("");
    try {
      await api(`/ai/actions/${action.id}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision, payload_hash: action.payload_hash }),
      });
      const result = await api<History>(
        `/ai/conversations/${action.conversation_id}`,
      );
      setHistory(result);
      setNotice(
        decision === "confirm"
          ? "Created successfully. Open Tasks or Reminders to manage it."
          : "Proposal dismissed. Nothing was created.",
      );
    } catch (error) {
      onError(error);
      setNotice(
        "Could not confirm the result. Refresh history before trying again; the same proposal cannot create a duplicate.",
      );
    } finally {
      setBusy(false);
    }
  }
  const sending =
    busy &&
    pending !== undefined &&
    !history.messages.some((m) => m.request_id === pending.request_id);
  const canSend = !busy && !pending && message.trim().length > 0;
  return (
    <section className={`panel ai-chat ${compact ? "compact" : ""}`}>
      <header className="ai-chat-bar">
        {compact && (
          <img className="ai-chat-logo" src="/axis-logo.png" alt="" />
        )}
        <label className="ai-chat-picker">
          <span className="sr-only">Conversation</span>
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
            className="ai-icon-button"
            disabled={busy}
            aria-label="Refresh history"
            title="Refresh history"
            onClick={() => void open(id)}
          >
            <RotateCw size={16} />
          </button>
        )}
        <button
          className="ai-icon-button"
          disabled={busy}
          title="New conversation"
          aria-label="New conversation"
          onClick={() => {
            setId(undefined);
            setHistory({ messages: [], requests: [] });
            setMessage("");
            setPending(undefined);
            setNotice("");
          }}
        >
          <SquarePen size={16} />
          {!compact && <span>New conversation</span>}
        </button>
        {toolbar}
      </header>
      <div
        className="ai-thread"
        ref={thread}
        aria-label="Conversation messages"
      >
        {history.messages.length === 0 && !sending && (
          <div className="ai-welcome">
            <img src="/axis-logo.png" alt="" />
            <h2>How can I help?</h2>
            <p>Ask anything, or have AXIS set up a task or reminder.</p>
            <div className="ai-suggestions">
              {suggestions.map((text) => (
                <button
                  key={text}
                  type="button"
                  disabled={busy || Boolean(pending)}
                  onClick={() => {
                    setMessage(text);
                    input.current?.focus();
                  }}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
        {history.messages.map((m) => (
          <article key={m.id} className={`ai-message ${m.role}`}>
            <span className="sr-only">
              {m.role === "user" ? "You" : `AXIS · ${m.model || "AI"}`}
            </span>
            <p>{m.content}</p>
            {(history.actions || [])
              .filter(
                (a) => a.request_id === m.request_id && m.role === "assistant",
              )
              .map((action) => (
                <section
                  className="ai-proposal"
                  key={action.id}
                  aria-label={`${action.payload.kind} proposal`}
                >
                  <span className="eyebrow">
                    {action.payload.kind === "task"
                      ? "NEW TASK"
                      : "NEW REMINDER"}
                  </span>
                  <h3>{action.payload.title}</h3>
                  {(action.payload.kind === "task"
                    ? action.payload.description
                    : action.payload.body) && (
                    <p>
                      {action.payload.kind === "task"
                        ? action.payload.description
                        : action.payload.body}
                    </p>
                  )}
                  <p className="ai-proposal-meta">
                    {action.payload.local_due
                      ? `${action.payload.local_due.replace("T", " ")} · ${action.payload.timezone}`
                      : "No due date"}
                    {action.payload.kind === "reminder" &&
                      ` · Repeats: ${action.payload.recurrence}`}
                  </p>
                  {action.status === "succeeded" ? (
                    <p className="ai-proposal-done">
                      <Check size={14} /> Created · record {action.entity_id}.
                      Open{" "}
                      {action.payload.kind === "task" ? "Tasks" : "Reminders"}{" "}
                      to manage it.
                    </p>
                  ) : action.status === "pending" ? (
                    <div className="ai-proposal-actions">
                      <button
                        className="primary"
                        disabled={busy}
                        aria-label={`Confirm create ${action.payload.kind}`}
                        onClick={() => void decide(action, "confirm")}
                      >
                        Create {action.payload.kind}
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        aria-label="Dismiss proposal"
                        onClick={() => void decide(action, "reject")}
                      >
                        Dismiss
                      </button>
                      <small
                        title={`UTC: ${action.payload.due_at ?? "none"}. To change details, dismiss and ask again.`}
                      >
                        Confirm by{" "}
                        {new Date(action.expires_at).toLocaleString()}
                      </small>
                    </div>
                  ) : (
                    <p className="ai-proposal-meta">Status: {action.status}</p>
                  )}
                </section>
              ))}
          </article>
        ))}
        {sending && (
          <>
            <div className="ai-bubble-preview" aria-hidden="true">
              {pending?.message}
            </div>
            <div className="ai-typing" aria-label="AXIS is thinking">
              <span />
              <span />
              <span />
            </div>
          </>
        )}
      </div>
      {(pending || notice) && !sending && (
        <div className="ai-chat-status">
          {latest && latest.status !== "succeeded" && pending ? (
            <p role="status">
              {errors[latest.error_code || ""] || "Waiting for a response."}
            </p>
          ) : (
            notice && <p role="status">{notice}</p>
          )}
          {pending && (
            <div className="ai-chat-status-actions">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void check()}
              >
                Check request status
              </button>
              {latest?.retryable && latest.attempts < 3 && (
                <button
                  className="text-button"
                  disabled={busy}
                  aria-label="Retry failed request (uses quota)"
                  onClick={() => void send(true)}
                >
                  Retry
                </button>
              )}
              <button
                className="text-button"
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
        </div>
      )}
      <form
        className="ai-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) void send();
        }}
      >
        <textarea
          ref={input}
          aria-label="Message"
          placeholder="Message AXIS…"
          rows={1}
          maxLength={4000}
          value={message}
          disabled={busy || Boolean(pending)}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSend) void send();
            }
          }}
          required
        />
        <div className="ai-composer-row">
          <label
            className="ai-context-toggle"
            title="Shares relevant tasks, projects and ordinary memories with your provider. Sensitive memories are excluded."
          >
            <input
              type="checkbox"
              checked={context}
              disabled={busy || Boolean(pending)}
              onChange={(event) => setContext(event.target.checked)}
            />
            Use my workspace
          </label>
          <button
            className="ai-send"
            disabled={!canSend}
            aria-label="Send to provider"
            title="Send (Enter)"
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </form>
      <small className="ai-footnote">
        AI can be wrong. Messages go to your configured provider and may use
        quota. Nothing is saved until you confirm.
      </small>
    </section>
  );
}
