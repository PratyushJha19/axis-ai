# AXIS — Master Context

**2026-10-20 M6 update:** ADR-026 adds separately consented primary Calendar reads,
encrypted credentials, cached busy constraints, operator-encrypted backups and
isolated restore/quarantine tooling. Calendar writes remain denied. Operational
schedules, off-machine storage, live Google acceptance and production recovery
targets require operator verification. See `15-m6-calendar-backups-recovery.md`.

**2026-10-19 planning update:** ADR-025 adds deterministic daily/weekly plans,
grounded briefings, optional BYOK advice, explicit reminder-aware task recovery
and opt-in proactive alerts through the existing worker. Plan acceptance is not
task completion or a calendar write. See `14-m5-daily-intelligence-planning.md`.

**2026-10-18 agent update:** ADR-024 adds durable bounded runs, internal reads and
task/reminder proposals through M4. Run `npm run dev:agent` separately from the
reminder worker. See `13-m4-5-agent-runtime-tool-execution.md`. Model output cannot
grant approval; external connectors remain disabled.

**2026-10-17 approval update:** ADR-023 adds a shared internal approval gate and
dashboard inbox for task/reminder proposals. External/high-risk operations remain
disabled; the fresh-authentication policy remains open. See
`12-m4-approval-security-gate.md` for implemented scope and acceptance limitations.

**2026-10-15 chat update:** ADR-021 and `chat-actions.md` add confirmed task and
reminder creation from chat, superseding earlier read-only restrictions for these
two internal operations only. General external action execution remains gated.

**2026-10-15 notification update:** The owner selected Telegram instead of paid
WhatsApp transport. ADR-019 and `telegram-setup.md` supersede WhatsApp requirements
for the current M3 notification slice. Email fallback is optional and defaults
off. Telegram confirms sent messages, not delivery/read receipts. Historical
WhatsApp product direction below is retained for context, not active setup.

**Version:** 1.0 | **Status:** Approved product direction, engineering details partly open  
**Owner:** Product owner / single initial user  
**Product name:** AXIS  
**Tagline:** “Everything in sync.”

## 1. Product in one paragraph

AXIS is a personal AI operating system and autonomous digital employee that reduces the user's cognitive load. It captures commitments, remembers useful context, organizes projects, proposes realistic plans, sends durable reminders, coordinates connected apps, and prepares actions for approval. The user should not have to mentally track every task, deadline, follow-up, or personal goal. AXIS can be proactive about surfacing what needs attention, but it must not independently perform consequential external actions without explicit approval.

## 2. Product principles

1. **Trust before cleverness.** Reliable reminders and accurate memory matter more than impressive demos.
2. **One source of truth.** Web dashboard, WhatsApp, scheduler, and integrations must read/write the same canonical records.
3. **Proactive, not presumptuous.** AXIS may suggest, plan, draft, and notify. It waits for approval before external-state-changing actions.
4. **Persistent by design.** A task or reminder must survive a chat reset, model outage, worker restart, and deployment.
5. **Transparent uncertainty.** Label confirmed facts, assumptions, and suggestions distinctly.
6. **Low cognitive load.** Concise briefings, sensible defaults, clear next actions, minimal unnecessary questions.
7. **Privacy and control.** User can inspect, correct, archive, export where feasible, and delete memory. Ask before saving sensitive personal facts.
8. **Recoverable.** Backups, idempotency, delivery tracking, and tested restore procedures are part of the product—not future polish.
9. **Build in slices.** Ship a trustworthy core before expanding into voice, broad browser automation, or multi-user SaaS.
10. **Future-ready, not prematurely complex.** Design for user/tenant isolation but begin as a single-user deployment.

## 3. Initial user and context

**2026-10-12 multi-user update:** The owner explicitly approved signup for anyone with a verified Google account. Each Google subject owns a separate private workspace and BYOK configuration. This supersedes the original single-user onboarding scope below, without adding team sharing, billing or public deployment. See ADR-017 and `multi-user-plan.md`.

Initial release is for one user. The user's current workload can include CAT preparation, college/dissertation work, client delivery, multiple projects/business initiatives, personal-brand content, fitness, and routine commitments. This context is illustrative; it must be editable and must not be hard-coded into business logic.

## 4. Desired user experience

- AXIS remembers commitments and surfaces them at the right time.
- A concise morning briefing is generated every morning.
- A rolling weekly plan is broken into realistic daily time blocks, respecting fixed commitments, focus blocks, rest, and buffers.
- Missed tasks are detected and a revised plan is proposed for approval.
- A reminder created without a time gets a suggested time based on deadline and importance; AXIS asks for confirmation before scheduling it.
- WhatsApp is a first-class conversational interface; the web dashboard uses the same state.
- If WhatsApp delivery is not confirmed within a configured timeout/retry policy, email fallback is attempted for that reminder. Do not send duplicates unnecessarily.
- Calendar integration begins read-only. Calendar changes require explicit approval.
- Voice notes and speech responses may follow the core MVP; live voice calls are deferred.
- The assistant has a natural, intelligent, concise, slightly witty personality. Tone must never obscure dates, statuses, risks, or confirmations.

## 5. Autonomy model

### Allowed without external-action approval

- Answer questions using accessible records.
- Search and summarize stored memory.
- Propose plans and schedules.
- Draft messages, emails, calendar events, and other actions.
- Create or update internal AXIS records when the user has clearly instructed it to do so and the change is not an external side effect. For ambiguous instructions, ask first.
- Send configured reminders/briefings through the user's explicitly connected and consented notification channels, under the notification policy.

### Requires explicit approval

- Sending a message/email to another person.
- Creating, modifying, or deleting events in an external calendar.
- Publishing content, submitting forms, making purchases, transferring money, deleting external records, or taking actions that represent the user.
- Any other action that changes state outside AXIS, unless a narrow, explicitly approved automation policy is added later.

### Additional high-risk gate

High-risk actions require both explicit action approval and fresh web authentication. The exact list of high-risk actions and freshness window are open decisions. Until defined, use a conservative classification and do not execute uncertain high-risk actions.

## 6. Memory model

AXIS has layered global and project-specific memory. Memory is not the same thing as a task, event, or reminder.

- **Global memory:** durable preferences, recurring routines, stable context.
- **Project memory:** goals, decisions, stakeholders, deliverables, constraints, and history scoped to a project.
- **Task records:** actionable work with status, priority, due date, dependencies, and ownership.
- **Reminder records:** scheduled notification intent and delivery state.
- **Conversation history:** useful for context but not authoritative for obligations.
- **Audit events:** append-only record of security-sensitive actions and outcomes.

Remember routine information by default. Ask before saving sensitive/personal facts. Each memory item should support provenance, confidence/status, timestamps, scope, and user correction/deletion. Distinguish **confirmed**, **assumed**, and **suggested** information. Archive inactive project memories without making them unsearchable.

## 7. MVP boundary

### Must ship in MVP

- Basic authenticated single-user web dashboard.
- Global/project memory capture, search, inspect, correct, archive, and delete.
- Task and commitment capture, status, priority, due date, project linkage, and confirmation flow for ambiguous input.
- Durable reminders stored in the database and processed by a separate worker.
- WhatsApp Sandbox integration for inbound messages and outbound reminders/approvals.
- Email fallback for any reminder whose WhatsApp delivery is not confirmed, using delivery state, timeout, bounded retries, and deduplication.
- Approval queue and server-enforced approval gate.
- Basic daily briefing and simple daily/weekly plan proposals.
- Audit trail, structured error states, monitoring hooks, backup automation, and restore-test procedure.
- Automated tests for the release blockers in `docs/09-test-plan-and-acceptance.md`.

### Later, not required for initial release

- Production WhatsApp sender and broader account onboarding.
- Live WhatsApp calls or phone calling.
- Full voice assistant; initial follow-on is voice-note transcription and speech responses.
- Broad browser automation and autonomous execution across third-party apps.
- Deep CRM/pipeline, CAT/fitness analytics, and rich integrations beyond the initial need.
- Multi-user commercial SaaS launch, billing, tenant administration, and complex role management.
- Dedicated vector database or separate distributed queue without demonstrated need.

## 8. Success metrics

Initial success is trust: the user relies on AXIS to remember commitments and surface important reminders.

Measure:

- Reminder delivery success and time-to-delivery by channel.
- Number of reminders with unknown/unresolved delivery outcome.
- Duplicate notification/action rate.
- Missed/late reminder incidents.
- Approval-gate bypass test results (must be zero).
- Task capture completeness and user correction rate.
- Memory retrieval relevance and correction/deletion success.
- Backup completion and restore-test success.
- User-reported usefulness of morning briefing and weekly plan.

Do not optimize for message volume or time spent in the app.

## 9. Reliability and recovery defaults

- Approval expiry: 24 hours.
- High-risk action: explicit approval plus fresh web authentication.
- Backup retention: 7 daily backups.
- Restore test: monthly.
- Recovery Point Objective (RPO) target: 24 hours.
- Recovery Time Objective (RTO) target: 4 hours.
- These are engineering targets, not guarantees; validate the chosen host/database plan.
- Bounded retries with exponential backoff and jitter where suitable.
- Reconcile uncertain provider timeouts before retrying consequential actions.
- Prevent duplicate effects with idempotency keys and provider message IDs.
- If WhatsApp delivery is not confirmed, email fallback is required by policy.
- Model provider failure must not stop reminders from running.

## 10. Product decisions still open

M1.5 resolves the initial inference choice as per-owner BYOK through Groq, with encrypted credentials and no fallback or tools. NVIDIA and other adapters remain pending. This supersedes the open provider choice only for this slice; see `10-m1-5-ai-provider-foundation.md` and ADR-016. AI setup is optional for the existing core and worker.

Do not silently lock these:

- Final hosting provider and exact free-tier limits.
- Exact model provider(s), pricing limits, and fallback order.
- Production WhatsApp provider/sender and delivery-status capabilities.
- Email provider and sending domain.
- Exact user timezone setting UX; persist IANA timezone, default initially from explicit user setup.
- High-risk action taxonomy and authentication freshness window.
- Approval revocation behavior after execution starts.
- Email fallback timeout and number/timing of retries.
- Quiet hours and urgent exception categories; user-configurable.
- Whether pgvector is needed after testing PostgreSQL full-text search.
- Exact calendar provider and OAuth scopes.
- Long-term multi-user onboarding and billing scope.

## 11. Language and status conventions

UI and logs must distinguish:

- **Saved** — persisted successfully.
- **Scheduled** — reminder/job exists and has a due time.
- **Sent** — provider accepted/sent the notification; not necessarily read.
- **Delivered** — provider confirmed delivery where available.
- **Unknown** — outcome cannot be confirmed.
- **Failed** — confirmed failure or retries exhausted.
- **Needs approval** — prepared but not authorized to execute.
- **Completed** — verified outcome, not merely a model claim.

Never say “delivered” if the provider only confirms “sent.”

## 12. M3 implementation decisions (2026-10-13)

The requested M3 personal notification scope is documented in
`11-m3-messaging-notifications.md` and ADR-018. It uses Twilio WhatsApp and Resend
email, verified user destinations and explicit saved channel consent. The initial
fallback deadline is configurable, defaulting to 300 seconds, with bounded retries
and query-only recovery of uncertain sends. This resolves the initial provider and
fallback defaults above; broader external actions still require the approval gate.
Live delivery acceptance is pending. See `m3-results.md` for tested outcomes.
