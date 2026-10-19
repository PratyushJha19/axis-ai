# M4.5 — Agent runtime and tool execution

## Audit and scope — 2026-10-17

Existing React/Express/Kysely/PostgreSQL architecture is retained. Google sessions
resolve the owner, with Origin/CSRF checks on writes. AIService owns encrypted BYOK
configuration, quotas, credential checks and the replaceable text adapter. Chat
and ordinary memory search are persistent. M4 migration 009 provides immutable
task/reminder proposals and an atomic local execution gate; external/high-risk
handlers and fresh reauthentication do not exist. Google OIDC is identity-only.
Telegram supports consented personal notifications, not general agent commands.

At the start of this audit no agent loop or connected-account credential store existed. Do not
pretend Google Calendar is connected. Start with implemented internal tools;
the connector boundary requires explicit owner/account permissions and a real
registered handler before any future external tool becomes available.

## Implementation plan and acceptance

Add migration 010 for owner-scoped agent runs and tool history, referencing existing
users, conversations and M4 proposals. Implement a bounded JSON protocol over the
existing text-completion adapter; no native tool support is assumed. Malformed
responses fail visibly, with no model/provider fallback or fabricated tools.

A separate agent worker shares domain/database conventions but does not add AI
calls to the reminder process. Runs are durable, leased and fenced. Persist a
model decision before handling tools. A stale inference without a persisted
response fails as uncertain and is never automatically resent. Persisted decisions
can resume without another provider call. Local read results and M4 proposal/run
associations commit atomically. Pending approvals survive browser/API/worker
restarts. The inbox remains the only approval authority; approval alone is not
execution. Resume from the actual M4 execution result.

Expose bounded profile, task, project, ordinary-memory, reminder and run-status
reads; create task/reminder through M4. Existing update services require additional
M4 action contracts and are not registered in this slice. No fake connectors.

Use strict server-owned schemas, limits, owner filters, content minimisation,
credential guards, sanitized audit/errors and a fixed tool allowlist. Tool results
are untrusted model context. Model answers are labelled separately from verified
handler outcomes. No arbitrary code, paths, URLs, SQL, provider selection, user ID
or approval metadata can be supplied as tool authority.

Add authenticated submit/list/detail/cancel/clarify APIs and agent controls in Chat,
including approval handoff, progress, actual tool outcomes and clarification.

Tests must cover valid/final/clarifying and malformed model replies, tools and
arguments, ownership, approval waits and resumption, replay/concurrency, recovery,
cancellation, provider failures/timeouts and finite resource limits. Run formatting,
lint, types, unit/security, PostgreSQL integration and browser regressions. Live
provider interpretation remains pending explicit user-run verification; tests use
synthetic keys and model responses only.

## Implemented operation

Migration 010 adds `agent_runs` and `agent_tool_calls`, owner-composite foreign keys,
request idempotency and unique step history. Schema readiness is 10. M4's existing
ledger and execution gate remain authoritative.

Registered reads: `get_current_user_context`, `search_tasks`, `get_task`,
`search_projects`, `get_project_context`, `search_memory`, `get_reminder`,
`get_agent_run_status`. Memory excludes sensitive entries; project memory requires
explicit owned project scope. `create_task` and `create_reminder` prepare M4
proposals. Review, approve and execute in Approvals; the worker resumes from the
stored execution result. Cancellation cannot undo an already executed action.

Runs are queued, running, waiting for approval/user, completed, failed, cancelled
or timed out. Leases last 90 seconds, with two concurrent runs globally. Read
batches execute sequentially; writes require a single-tool batch. Runs expire after
25 hours. Per-user submission limits are three active runs and 20 starts/hour,
in addition to existing BYOK quotas. Failed tool batches roll back atomically.

Optional agent-process environment settings (blank uses default):

| Variable                 | Default | Allowed range |
| ------------------------ | ------- | ------------- |
| `AGENT_MAX_ITERATIONS`   | 6       | 1–12          |
| `AGENT_MAX_TOOLS`        | 8       | 1–20          |
| `AGENT_MAX_TOKENS`       | 20000   | 100–100000    |
| `AGENT_RESULT_BYTES`     | 8000    | 256–16000     |
| `AGENT_MODEL_TIMEOUT_MS` | 25000   | 10–65000      |

Token accounting uses provider-reported usage. Iteration and context/output limits
remain enforced if usage is absent. Cancellation/timeout cannot recall a provider
call, but late responses cannot create effects. Unknown inference is not retried.

## API and interface

All routes are session authenticated and owner scoped under `/api/v1`; writes use
existing CSRF/Origin protections.

| Method/path                    | Contract                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| POST `/agent/runs`             | `goal`, UUID `idempotency_key`, `consent: true`, optional owned `conversation_id`; returns 202 with ID/status |
| GET `/agent/runs`              | Optional offset/status; pages of 20                                                                           |
| GET `/agent/runs/:id`          | Safe run summary and persisted tool results                                                                   |
| POST `/agent/runs/:id/cancel`  | Empty object; fence future steps and cancel pending proposal                                                  |
| POST `/agent/runs/:id/clarify` | `message` up to 2000 characters while waiting for user                                                        |

Chat's **Delegate a task** panel includes explicit provider-use consent, goals,
history, cancellation, clarification, exact approval handoff and actual results.
Selected conversation context is limited to four recent messages. Model prose is
labelled separately from backend evidence. APIs do not expose raw transcripts or
credentials. Private run/tool content is persisted in PostgreSQL, not logged.
No automatic agent-history retention/deletion policy is introduced.

## Startup and limitations

Stop AXIS processes before upgrading. Run `npm run dev` to migrate and start the
API/dashboard, `npm run dev:worker` in a second terminal for reminders, and
`npm run dev:agent` in a third for agent runs. Existing `DATABASE_URL`, AI encryption
settings and each user's saved Groq key/model are reused. No new service account,
dependency or paid infrastructure is needed. Without the agent process, runs
remain queued until it returns or the deadline passes. Reminder worker health
does not measure the agent process.

Groq's text adapter supports the JSON-text protocol; native tool calls are unused.
Tests use synthetic providers. No live model workflow was authorized or verified;
model adherence and account entitlement remain manual checks. Malformed responses
fail visibly without fallback. Calendar OAuth, external tools, task updates, note
writes, arbitrary network/code execution, fresh high-risk authentication and M5
planning remain unavailable. A future connector needs a real owner-bound account,
permission checks, validated handler and applicable M4 policy before registration.
See `m4-5-results.md` for actual verification.
