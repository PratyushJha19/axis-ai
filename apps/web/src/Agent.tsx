import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  MessageCircleQuestion,
  Play,
  Square,
  Wrench,
} from "lucide-react";
import type { AgentRun, AgentCall } from "../../../packages/shared/src/agent";
import { api } from "./api";
const finished = ["completed", "failed", "cancelled", "timed_out"];
const runTone = (status: string) =>
  status === "completed"
    ? "done"
    : ["failed", "timed_out"].includes(status)
      ? "bad"
      : status === "cancelled"
        ? "muted"
        : status.startsWith("waiting")
          ? "review"
          : "ready";
const callTone = (status: string) =>
  status === "succeeded" ? "done" : status === "failed" ? "bad" : "ready";
const words = (value: string) => value.replaceAll("_", " ");
export function AgentPanel({
  onError,
  conversationId,
}: {
  onError: (error: unknown) => void;
  conversationId?: string | null;
}) {
  const [runs, setRuns] = useState<AgentRun[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<{
      run: AgentRun;
      calls: AgentCall[];
    } | null>(null),
    [busy, setBusy] = useState(false),
    [goal, setGoal] = useState(""),
    [consent, setConsent] = useState(false),
    [reply, setReply] = useState(""),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false);
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    key.current = crypto.randomUUID();
  }, [conversationId]);
  const refresh = useCallback(async () => {
    const result = await api<{ items: AgentRun[]; hasMore: boolean }>(
      `/agent/runs?offset=${offset}`,
    );
    setRuns(result.items);
    setMore(result.hasMore);
    if (selected) setDetail(await api(`/agent/runs/${selected}`));
  }, [selected, offset]);
  useEffect(() => {
    void refresh().catch(onError);
    const timer = setInterval(() => void refresh().catch(onError), 5000);
    return () => clearInterval(timer);
  }, [refresh, onError]);
  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ id: string }>("/agent/runs", {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: key.current,
          goal,
          ...(conversationId ? { conversation_id: conversationId } : {}),
          consent: true,
        }),
      });
      setSelected(r.id);
      key.current = crypto.randomUUID();
      setGoal("");
      await refresh();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function change(cancel: boolean) {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/agent/runs/${selected}/${cancel ? "cancel" : "clarify"}`, {
        method: "POST",
        body: JSON.stringify(cancel ? {} : { message: reply }),
      });
      setReply("");
      await refresh();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel agent-panel" aria-label="Agent tasks">
      <header className="agent-head">
        <span className="agent-mark" aria-hidden="true">
          <Bot size={18} />
        </span>
        <div>
          <h2>Delegate a task</h2>
          <p>
            Read your AXIS records and prepare tasks or reminders for approval.
            Requires the separate agent worker. External apps are not connected.
          </p>
        </div>
      </header>
      <form
        className="agent-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="agent-goal">
          <span className="sr-only">Agent goal</span>
          <textarea
            required
            rows={3}
            maxLength={4000}
            value={goal}
            disabled={busy}
            placeholder="e.g. Review my overdue tasks and draft a reminder for each"
            onChange={(e) => {
              setGoal(e.target.value);
              key.current = crypto.randomUUID();
            }}
          />
        </label>
        <label className="planning-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          Allow this run to send my goal, recent selected conversation and
          relevant ordinary AXIS records to my configured AI provider. This may
          use quota. Writes still require approval.
        </label>
        <button className="primary" type="submit" disabled={busy || !consent}>
          <Play size={15} /> Start agent task
        </button>
      </form>
      <div className="agent-runs">
        <div className="agent-runs-bar">
          <label className="field">
            Agent run
            <select
              value={selected || ""}
              onChange={(e) => {
                setSelected(e.target.value || null);
                setDetail(null);
              }}
            >
              <option value="">Select a run</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.goal.slice(0, 70)} · {r.status}
                </option>
              ))}
            </select>
          </label>
          <button
            className="icon-button"
            aria-label="Previous runs"
            title="Previous runs"
            disabled={offset === 0 || busy}
            onClick={() => setOffset(offset - 20)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="More runs"
            title="More runs"
            disabled={!more || busy}
            onClick={() => setOffset(offset + 20)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        {!detail && (
          <p className="agent-empty">
            {runs.length
              ? "Select a run to follow its progress and recorded outcomes."
              : "No agent runs yet. Runs survive closing this page."}
          </p>
        )}
        {detail && (
          <article className={`agent-run tone-${runTone(detail.run.status)}`}>
            <header>
              <h3>{detail.run.goal}</h3>
              <p role="status" className="approval-status">
                Run status: {words(detail.run.status)} · {detail.run.tool_count}{" "}
                tool steps
              </p>
            </header>
            {detail.run.error_code && (
              <p role="alert" className="approval-alert">
                <CircleAlert size={15} />
                <span>
                  Stopped: {detail.run.error_code}. No automatic retry. Check AI
                  Settings or start a new clarified request. Review existing
                  outcomes before repeating a write.
                </span>
              </p>
            )}
            {detail.run.waiting_for_proposal_id && (
              <div className="agent-callout">
                <a
                  className="secondary"
                  href={`/?view=approvals&proposal=${detail.run.waiting_for_proposal_id}`}
                >
                  Review exact action in Approvals <ArrowUpRight size={14} />
                </a>
                <small>
                  Approval alone does not execute the action; use Execute there.
                  This run resumes when the worker sees the result.
                </small>
              </div>
            )}
            {detail.run.answer && (
              <div className="agent-answer">
                <h4>
                  {detail.run.status === "waiting_for_user" ? (
                    <>
                      <MessageCircleQuestion size={14} /> Clarification needed
                    </>
                  ) : (
                    "AI response — verify against recorded results below"
                  )}
                </h4>
                <p>{detail.run.answer}</p>
              </div>
            )}
            {detail.run.status === "waiting_for_user" && (
              <form
                className="agent-reply"
                onSubmit={(e) => {
                  e.preventDefault();
                  void change(false);
                }}
              >
                <label className="field">
                  Your clarification
                  <input
                    required
                    maxLength={2000}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Continue agent task
                </button>
              </form>
            )}
            <h4 className="agent-subhead">
              <Wrench size={13} /> Recorded tool outcomes
            </h4>
            {!detail.calls.length ? (
              <p className="agent-empty">
                No tool has completed. A model response alone is not evidence of
                an action.
              </p>
            ) : (
              <ol className="agent-calls">
                {detail.calls.map((c) => (
                  <li key={c.id} className={`tone-${callTone(c.status)}`}>
                    <p>
                      <strong className="capitalize">{words(c.tool_id)}</strong>
                      <span className="capitalize">{words(c.status)}</span>
                    </p>
                    <details>
                      <summary>View returned data</summary>
                      <pre>{JSON.stringify(c.result, null, 2)}</pre>
                    </details>
                  </li>
                ))}
              </ol>
            )}
            <footer>
              {!finished.includes(detail.run.status) && (
                <button
                  className="text-button approval-cancel"
                  disabled={busy}
                  onClick={() => void change(true)}
                >
                  <Square size={12} /> Cancel agent task
                </button>
              )}
              <small>
                Cancellation stops future steps; completed actions are not
                undone. Runs survive closing this page.
              </small>
            </footer>
          </article>
        )}
      </div>
    </section>
  );
}
