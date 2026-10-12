# M2 — Durable reminders implementation plan

Scope: PostgreSQL reminder schedules, occurrences/attempt history, independent
worker, owner-scoped APIs and a reminder view inside the existing dashboard.
Delivery is mock only; no Twilio/email clients, outbound calls or M3 fallback.

Acceptance: clean and upgrade migrations, restart persistence, concurrent claims,
expired-lease recovery, fenced stale workers, unknown outcome reconciliation before
retry, cancellation race, DST/local timezone, quiet hours/focus deferral, recurrence,
bounded retries, ownership/CSRF validation, and existing M1 regression checks.

Implementation sequence:

1. Shared schemas/time utilities and migration 003 using existing Kysely SQL patterns.
2. Transactional reminder API, version checks, durable idempotency and audit.
3. Worker claim/dispatch/reconcile phases and durable mock-provider receipts.
4. Reminder UI, schedule confirmation, attempt details and worker status.
5. Deterministic database tests, process recovery tests, browser workflow and results.

The owner approved quiet/focus deferral for all reminders without urgent bypass,
one overdue occurrence with missed repeats counted/skipped, and mock-only defaults
of three attempts, 30-second exponential backoff with jitter capped at 15 minutes,
60-second leases, and bounded reconciliation. These decisions are recorded in
ADR-015. Real notification approval exception and fallback policy remain M3 decisions.
Initial recurrence scope: daily/weekly wall-clock schedules,
explicit DST disambiguation, no arbitrary RRULE parser or task recurrence changes.
No deployment, paid resources or personal-data fixtures.
