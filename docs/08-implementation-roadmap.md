# AXIS — Implementation Roadmap

**Version:** 1.0 | **Rule:** Complete one milestone and verify it before moving on.

## Milestone M0 — Foundation and decisions

**Goal:** establish a safe, runnable project without building product features prematurely.

Tasks:

- Inspect repository and existing assets before changes.
- Confirm package manager, monorepo approach, auth approach, database/ORM, hosting constraints, and model-provider options; record decisions.
- Create repo structure, lint/format/typecheck/test scripts.
- Add `.env.example` with variable names only.
- Set up local PostgreSQL and migration workflow.
- Add health endpoint and structured logging with request/correlation IDs.
- Add CI checks where available.
- Add threat model and initial runbook.

Acceptance:

- Clean install and documented local startup.
- Empty database can be migrated from scratch.
- Health checks work.
- No secrets committed.
- Lint, typecheck, and test commands run successfully.
- No paid service is provisioned without owner approval.

**Stop and report before M1 if any major decision is blocked.**

## Milestone M1 — Identity, projects, memory, tasks

Goal: persistent core records with a minimal usable web UI.

Tasks:

- Secure single-owner authentication and server-side ownership scope.
- Database migrations for users, projects, memory, tasks, task events.
- CRUD APIs with validation and pagination.
- Memory search using PostgreSQL full-text search initially.
- Memory inspect/correct/archive/delete and sensitive-memory consent.
- Task capture/list/edit/complete/defer.
- Minimal responsive dashboard.
- Seed synthetic demo data only.

Acceptance:

- Records survive restart.
- User scope tests pass.
- Memory uncertainty/provenance visible.
- Sensitive-memory consent enforced.
- Migrations and API contract tests pass.

## Milestone M1.5 — AI provider foundation (BYOK)

Owner-requested extension on 2026-10-15: [confirmed chat creation](chat-actions.md)
adds task/reminder drafts and backend confirmation, with ownership, expiry,
idempotency and UI tests. This narrowly supersedes the read-only restriction below;
it does not authorize a general M4 external executor.

Added after the owner's completed M2 baseline. Implement secure per-owner provider settings, authenticated encryption, a real Groq adapter, basic persistent chat and bounded read-only memory/task/project retrieval. Preserve M1 and M2. No automatic fallback, tools, autonomous actions, or multi-user onboarding.

Acceptance: encrypted credential lifecycle and redaction, ownership isolation, strict models, provider failures, idempotency/unknown outcomes, API/UI tests and M1/M2 regressions. An actual provider call through the UI remains a separate required live gate. See `10-m1-5-ai-provider-foundation.md` and `m1-5-results.md`. Stop here for review; do not begin M3/M4.

## Milestone M2 — Durable reminder engine

Goal: dependable reminders independent of AI and web chat.

Tasks:

- Reminder and notification-attempt schema.
- Worker process with atomic claims/leases.
- Fake-clock test harness.
- Retry classification/backoff, cancellation, snooze, quiet hours.
- Structured attempt status and owner-facing system status.
- Email/WhatsApp adapter interfaces using mocks first.
- Reconciliation for unknown provider outcomes.

Acceptance:

- Worker restart does not lose reminders.
- Concurrent workers do not duplicate a logical attempt.
- Provider timeout is represented as unknown and reconciled.
- Model outage does not stop scheduled reminders.
- Core reliability scenarios pass.

## Milestone M3 — WhatsApp Sandbox and email fallback

**2026-10-15 revision:** Telegram replaces active WhatsApp delivery at the owner's
request. See ADR-019, `telegram-setup.md` and `telegram-results.md`. Keep durable
scheduling, owner isolation and retry/crash tests; validate polling/linking and
sent semantics without inventing delivery receipts. Email fallback is optional.
Live Telegram acceptance is pending. No M4 scope is authorized.

Current implementation (2026-10-13): the separately requested M3 adds Twilio and
Resend adapters, durable channel jobs, signed callbacks, consented owner settings,
fallback and notification history. See `11-m3-messaging-notifications.md`,
ADR-018 and `m3-results.md` for policies and actual verification. Live Sandbox and
email acceptance remain pending external configuration and explicit recipient
authorization. Default delivery remains mock. Stop for review before M4.

Before M3, the owner requested a focused multi-user identity milestone on 2026-10-12: open enrollment for verified Google accounts, preserve existing users, and prove two-session isolation across M1/M1.5/M2. See `multi-user-plan.md` and `multi-user-results.md`. This does not authorize M3 or public deployment.

Goal: end-to-end messaging in a controlled test environment.

Tasks:

- Twilio Sandbox setup using owner-provided credentials.
- Verify webhook signatures and owner binding.
- Inbound message normalization.
- Outbound reminder send and provider status callbacks.
- Email adapter and verified owner destination.
- Fallback timeout/retry configuration.
- Idempotent callbacks and one logical email fallback per reminder.
- Clear sandbox/test labels in UI.

Acceptance:

- Test reminder sent to authorized sandbox recipient.
- Delivery states accurately reflect provider semantics.
- Unconfirmed WhatsApp triggers email fallback under configured policy.
- Replayed webhooks do not create duplicate fallback.
- Missing email/configuration surfaces an alert.
- No real third-party messaging without owner approval.

## Milestone M4 — Approval/security gate

Goal: central, testable authorization for all external actions.

Tasks:

- Immutable action proposal and payload hash.
- 24-hour expiry.
- Approve/reject via web.
- Verified WhatsApp approval for non-high-risk actions, if safe and feasible.
- High-risk web re-auth gate (risk taxonomy/freshness policy must be decided).
- Idempotent execution, audit trail, reconciliation for unknown outcomes.
- Penetration-style tests of direct API bypasses.

Acceptance:

- Unapproved, expired, altered, replayed, and concurrent execution attempts fail safely.
- High-risk action requires fresh web authentication.
- Audit events cover full lifecycle.
- No live external action is enabled by default.

## Milestone M4.5 — Agent runtime and tool execution

Owner-requested intermediate milestone: durable bounded runs using existing BYOK,
internal tools, M4-gated creation and Chat status. Keep inference independent of
reminders. Acceptance covers validation, isolation, limits, recovery, cancellation,
approval resumption and regressions. External connectors stay disabled. See
`13-m4-5-agent-runtime-tool-execution.md` and `m4-5-results.md`.
Stop for review before M5.

## Milestone M5 — Dashboard and daily experience

**2026-10-19 implementation:** The owner's expanded M5 specification is recorded
in `14-m5-daily-intelligence-planning.md`. It adds deterministic briefings/ranking,
daily/weekly plans, explicit recovery, optional AI advice and consented proactive
events. See `m5-results.md` for actual checks and limitations. Calendar, project
deadlines and dependency graphs remain unavailable. Stop for review before M6.

Goal: make the core system useful every day.

Tasks:

- Home command center.
- Today/upcoming/overdue task views.
- Reminder delivery detail and inbox.
- Memory browser.
- Pending approvals.
- Daily briefing generation and delivery.
- Weekly plan proposals with constraints, rest and buffers.
- Missed-task detection and rescheduling proposal.

Acceptance:

- Briefing reflects persisted state.
- Planner avoids overlapping accepted blocks and fixed commitments.
- Missed tasks are proposed for rescheduling, not silently moved.
- Briefing failure does not break reminders.

## Milestone M6 — Calendar read-only and operational hardening

Implementation and local verification are recorded in
`15-m6-calendar-backups-recovery.md` and `m6-results.md`. Primary Calendar only;
read-only explicit consent. Encrypted backup/restore commands and scheduler setup
are supplied, but no production schedule/storage/live acceptance is claimed.
Stop for review before M7.

Goal: integrate schedule context and prove recovery.

Tasks:

- Google Calendar read-only integration with least-privilege scopes.
- Integration disconnect/revocation.
- Daily backups, seven-day retention, monthly restore test procedure.
- Runbook for provider failure, worker backlog, secret rotation, restore.
- Verify RPO/RTO targets against actual hosting plan.
- End-to-end tests for recovery and reminder reconciliation.

Acceptance:

- Calendar events appear as read-only commitments.
- Revoked access is detected and handled.
- Restore test is documented and successful.
- Reminder/action reconciliation after restore prevents duplicate effects.

## Milestone M7 — Follow-on capabilities

Only after core release gates pass:

- Voice-note transcription and speech responses.
- Rich client/project pipeline.
- CAT/fitness tracking and other domain-specific modules.
- Browser automation behind narrow allowlists and approval gates.
- Additional integrations and model providers.
- Production WhatsApp setup after provider eligibility/consent review.
- Multi-user tenancy, onboarding, billing, and commercial productization.

## Milestone reporting template

For each milestone, report:

- Scope completed.
- Files/modules changed.
- Commands actually run and results.
- Acceptance criteria pass/fail.
- Manual setup still needed.
- Risks/open decisions.
- Estimated next step.
- Whether any external service, paid resource, or real-world action was touched.
