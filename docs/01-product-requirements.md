# AXIS — Product Requirements Document (PRD)

**Version:** 1.0 | **Status:** MVP scope baseline

## 1. Problem statement

The user has many concurrent commitments and does not want to mentally track tasks, deadlines, project details, reminders, and follow-ups. Existing chat assistants can answer questions but are not a trustworthy system of record for obligations. AXIS must combine useful memory, structured work records, proactive planning, durable reminders, and approval-gated actions.

## 2. Goals

- Capture commitments quickly from web and WhatsApp.
- Retrieve relevant global and project context.
- Maintain reliable task and reminder state outside model context.
- Generate a concise daily briefing and rolling weekly plan.
- Detect overdue/missed tasks and propose a revised schedule.
- Notify through WhatsApp with email fallback when delivery is unconfirmed.
- Prepare external actions and require approval before execution.
- Provide enough visibility to inspect what AXIS remembers and what it has done.

## 3. Non-goals for MVP

- Fully autonomous external execution.
- Live calling, full duplex voice, or wake-word assistant.
- Guaranteed zero downtime or guaranteed free hosting.
- Production multi-tenant SaaS, billing, or team collaboration.
- Replacing a full project-management or CRM suite.
- Storing payment credentials or performing financial transactions.
- Unrestricted browser access or arbitrary code execution by model output.

## 4. Personas and primary jobs

### Primary user
A single individual managing personal goals, studies, projects, clients, and routines.

### Jobs to be done
1. “Remember this and help me find it later.”
2. “Turn this commitment into a task and remind me at the right time.”
3. “Tell me what matters today and propose a realistic plan.”
4. “Notice when I have fallen behind and help me recover.”
5. “Prepare this external action, show me exactly what will happen, and wait for my approval.”
6. “Tell me whether a reminder or action actually succeeded.”

## 5. Functional requirements

Priority labels: **P0** release blocker, **P1** core MVP, **P2** follow-on.

### FR-01: Identity and access (P0)
- Support one owner account initially.
- Protect dashboard and APIs behind authentication.
- Keep an architecture seam for future user/tenant IDs.
- Do not expose unauthenticated memory, tasks, reminders, approvals, logs, or integration settings.
- Authentication provider is an open implementation decision; choose a secure, maintained option and document it before wiring real accounts.

**Acceptance:** unauthenticated API requests are denied; all user-owned records are scoped to the authenticated owner.

### FR-02: Quick capture (P1)
- Accept natural-language input in web chat and WhatsApp.
- Extract candidate task, commitment, project, date/time, recurrence, and importance.
- Validate model output against a schema.
- Ask clarifying questions for materially ambiguous instructions.
- Do not silently create an external action from an ambiguous request.
- If a reminder time is missing, propose a time based on deadline/importance and ask the user to confirm.

**Acceptance:** invalid or incomplete model output never creates malformed records; ambiguous date/time produces a clarification or proposal.

### FR-03: Memory (P0)
- Support global and project-scoped memory.
- Each item includes content, type, scope, source/provenance, confidence/status, created/updated timestamps, and optional expiry/archive status.
- Remember routine information by default; ask before saving sensitive/personal facts.
- Allow inspect, edit/correct, archive, delete, and search.
- Mark records as confirmed, assumed, or suggested.
- Inactive project memory can be archived but remains searchable.
- Avoid saving credentials or secrets as memory.

**Acceptance:** users can find and correct an item; deleted items are not returned by ordinary retrieval; project-scoped search does not leak into another user's scope when multi-user support is added.

### FR-04: Tasks and commitments (P0)
- Create, view, edit, complete, cancel, defer, and archive tasks.
- Fields: title, description, status, priority, due date/time, timezone, estimated duration, project, dependencies, source, created/updated timestamps.
- Use explicit status values, not ambiguous free text.
- Track task history for meaningful status changes.
- Completion of recurring tasks generates the next occurrence according to its recurrence rule.
- Missed tasks are detected and a reschedule proposal is prepared, not silently applied.

**Acceptance:** task state survives restart; completing a recurring task produces exactly one next occurrence.

### FR-05: Durable reminders (P0)
- Reminders are database records with due time, timezone, linked entity, channel policy, status, delivery attempts, and next retry.
- Scheduler/worker is independent of chat and model providers.
- Support reminders at creation, before deadline, on due date, and after overdue; exact offsets are configurable and must be surfaced to the user when creating the reminder.
- Every notification attempt has a traceable result.
- WhatsApp delivery not confirmed within configured policy triggers email fallback.
- Deduplicate across retries and webhook replays.
- Quiet hours and focus blocks are respected, with user-configurable urgent exceptions.

**Acceptance:** restart/model outage does not erase reminders; simulated provider timeout results in a tracked unknown state and appropriate retry/fallback.

### FR-06: Approvals and external actions (P0)
- Any external-state-changing action must be represented as an action proposal with a unique ID, immutable payload, destination, risk level, expiry, and status.
- Approval can be given through authenticated web UI or a verified WhatsApp interaction linked to the user.
- Backend validates the approval and action payload before execution.
- Approval expires after 24 hours.
- High-risk actions require explicit approval plus fresh web authentication.
- Material payload/destination change invalidates prior approval.
- Approval is consumed once; concurrent/replayed requests cannot execute twice.
- Record proposal, approval/rejection/expiry, execution attempt, and outcome in the audit trail.
- If execution outcome is uncertain, reconcile before retrying.

**Acceptance:** attempts to execute without valid approval fail server-side even if the client calls the endpoint directly.

### FR-07: Daily briefing and planning (P1)
- Produce a concise morning briefing with today's fixed commitments, top priorities, deadlines, reminders needing attention, and pending approvals.
- Maintain a rolling weekly plan with time blocks.
- Fixed commitments first; then priorities; then flexible tasks, rest, and buffers.
- Consider urgency, importance, effort, dependencies, available time, and long-term goals.
- The plan is a proposal. User approval is required before it changes external calendars or applies consequential rescheduling.
- Clearly label estimated duration and uncertain assumptions.

**Acceptance:** planner does not schedule two tasks into the same time block or over a fixed commitment; it leaves buffers and flags unschedulable work.

### FR-08: Notifications and inbox (P0)
- Show pending approvals, failed/unknown reminders, upcoming deadlines, and important system alerts in a central inbox.
- Send configured reminders and briefings through consented channels.
- WhatsApp is primary for MVP; email is fallback if WhatsApp delivery is unconfirmed.
- Delivery status is explicit: queued, sent, delivered (if confirmed), failed, unknown, fallback queued/sent, or cancelled.
- Do not confuse provider acceptance with confirmed delivery.

### FR-09: Integrations (P1/P2)
- MVP: WhatsApp Sandbox; email fallback; optional read-only Google Calendar after core reminder reliability is proven.
- Calendar is read-only initially. Calendar writes require approval and are out of initial scope unless explicitly enabled.
- Use least-privilege scopes, revocable credentials, provider adapters, and clear connection status.
- Integration errors should not corrupt core records.

### FR-10: Dashboard and chat (P1)
- Responsive web dashboard, desktop and mobile.
- Dark mode default; optional light mode.
- Hybrid command center + persistent assistant panel.
- Show today's agenda, priority tasks, deadlines, pending approvals, recent memory/conversations, project status, notification health, and quick capture.
- Mobile defaults to chat-first with easy dashboard access.
- Keep UX concise; make status and next action obvious.

### FR-11: Observability and recovery (P0)
- Structured logs, correlation IDs, audit events, health checks, and metrics for reminder delivery, retries, approval outcomes, and worker health.
- Daily automated database backups, seven daily copies retained.
- Monthly isolated restore test.
- Target RPO ≤24 hours and RTO ≤4 hours, subject to hosting/provider validation.
- Reconcile reminder schedules and delivery attempts after recovery.

## 6. Core user flows

### Flow A: Save a memory
1. User shares a fact or preference.
2. AXIS classifies it as routine or potentially sensitive.
3. Routine facts may be saved by default; sensitive/personal facts require confirmation.
4. AXIS reports what was saved and how to inspect/edit/delete it.

### Flow B: Create a task and reminder
1. User asks to remember a task.
2. AXIS extracts fields and checks ambiguity.
3. If date/time is missing, propose a reminder time and ask for confirmation.
4. Persist task and reminder transactionally where appropriate.
5. Scheduler claims due reminder and records an attempt.
6. WhatsApp sends; delivery status is tracked.
7. If delivery is unconfirmed after policy timeout/retries, queue email fallback.
8. Surface final status honestly.

### Flow C: Approve external action
1. AXIS prepares a draft and immutable payload.
2. User sees destination, exact content/effect, risk, and expiry.
3. User approves via authenticated dashboard or verified WhatsApp flow.
4. Backend checks ownership, status, expiry, payload hash, risk gate, and idempotency.
5. Execute once; persist result and audit event.
6. If outcome is unknown, reconcile before retrying.

### Flow D: Recover missed tasks
1. Worker detects overdue tasks according to policy.
2. Planner considers constraints and remaining capacity.
3. AXIS presents a proposed revised plan.
4. User approves or edits it.
5. AXIS updates internal plan records; external calendar changes remain approval-gated.

## 7. MVP release gates

Release is blocked by any of:
- Critical reminder can be lost silently.
- Approval gate can be bypassed.
- Duplicate consequential action can occur in retry/replay/concurrency tests.
- Failed recovery/restore test.
- Secret exposure in repository, logs, client bundles, or docs.
- User-owned data can be accessed across identities.
- Reminder fallback policy is untested.
- No documented runbook for worker/provider failure.

## 8. Analytics events

Use privacy-minimizing event names and avoid raw sensitive content:
- `task_created`, `task_completed`, `task_deferred`
- `memory_saved`, `memory_corrected`, `memory_deleted`
- `reminder_scheduled`, `reminder_attempted`, `reminder_delivered`, `reminder_failed`, `reminder_fallback_triggered`
- `approval_requested`, `approval_accepted`, `approval_rejected`, `approval_expired`
- `action_execution_succeeded`, `action_execution_failed`, `action_execution_unknown`
- `backup_completed`, `restore_test_completed`

Analytics must not store message bodies, memory text, access tokens, or unnecessary personal details.
