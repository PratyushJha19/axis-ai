# Reminder archive and seven-day retention

2026-10-16. Owner-requested reminder maintenance; no new external integration.

## Behavior

- Reminders opens on **Active**. Choose **Archive** in Reminder view for finished
  and cancelled items. The page refreshes every 15 seconds when no editor or
  operation is open; Refresh reminders updates immediately.
- One-time reminders archive after confirmed delivery, or settled Telegram sent
  evidence. Cancelled reminders also archive. Recurring reminders with future
  occurrences, failed reminders and unknown sends remain active.
- Archive is read-only history, not a way to restart delivery. Each row shows
  when it becomes eligible for deletion, seven full days after archiving.
- The independent worker removes eligible reminder rows and their notification
  jobs/attempt details in atomic batches of up to 50, once a minute. If offline,
  cleanup resumes after startup. The database is the retention source of truth.
- Pending, leased or unresolved delivery work blocks cleanup, even beyond seven
  days. Cleanup does not send, retry or recall messages.
- Content-free audit records, request-idempotency entries, mock receipt IDs and
  webhook deduplication keys remain to prevent replay and preserve audit evidence.
  Existing chat messages/proposals are separate history and are not deleted by
  reminder retention. Messages already on Telegram/email are not removed.

## Upgrade

Stop API and worker, then run `npm run dev` and `npm run dev:worker` in separate
terminals. Migration `008-reminder-archive` adds `archived_at`, an archive-state
trigger and cleanup index; readiness requires schema version 8. Existing finished
reminders move to Archive with a fresh seven-day grace period at migration time.
No immediate bulk deletion, new credentials or environment variables are needed.
For a separately managed database, run migrations/build and start API/worker
individually as described in `../setup_guide.md`.

## Implementation

- Migration 008, migrator and readiness check.
- Shared Reminder type and owner-filtered list API: `GET /api/v1/reminders`
  defaults to active; `?view=archive` selects archive. Pagination follows filtering.
- `services/worker/src/reminder-retention.ts` locks candidate reminders and child
  jobs, rechecks transport eligibility and deletes in one transaction. Concurrent
  workers skip locked reminders. Failed transactions preserve all records.
- Worker main loop, Reminders UI, integration and browser tests.
- Existing direct lookup/attempt endpoints remain owner-scoped during retention;
  after deletion they return not found. Durable idempotency records prevent a
  replayed old creation request from silently recreating a purged reminder.

## Verification

- `npm run check`: formatting, lint, TypeScript and all 34 unit/security tests passed.
- `npm run build`: passed.
- `./scripts/verify-local.ps1`: 71 tests passed, including archive classification,
  seven-day boundary, concurrent cleanup, child-history deletion and unresolved
  transport preservation. Additional owner-scoped archive API assertions were
  included in the final regression run.
  Final isolated database: `axis_test_0d3fc2db7f63`.
- `./scripts/verify-local.ps1 -Browser`: all six tests passed in isolated database
  `axis_test_e2e_7a4b27f40a43`, including Active-to-Archive transitions and archived
  delivery history. An initial selector mismatch was corrected to use the
  accessible combobox name.

No live messages, real reminder deletion, deployment or paid service was performed
while implementing/testing. Apply the migration and restart to activate the policy.
